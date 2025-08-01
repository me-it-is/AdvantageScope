// Copyright (c) 2021-2025 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

import { CoordinateSystem } from "./AdvantageScopeAssets";
import Log from "./log/Log";
import { getOrDefault, getRobotStateRanges } from "./log/LogUtil";
import LoggableType from "./log/LoggableType";
import { Units } from "./units";
import { indexArray, jsonCopy } from "./util";

export type Translation2d = [number, number]; // meters (x, y)
export type Rotation2d = number; // radians
export type Pose2d = {
  translation: Translation2d;
  rotation: Rotation2d;
};
export const Translation2dZero: Translation2d = [0, 0];
export const Rotation2dZero: Rotation2d = 0;
export const Pose2dZero: Pose2d = {
  translation: Translation2dZero,
  rotation: Rotation2dZero
};

export type Translation3d = [number, number, number]; // meters (x, y, z)
export type Rotation3d = [number, number, number, number]; // radians (w, x, y, z)
export type Pose3d = {
  translation: Translation3d;
  rotation: Rotation3d;
};
export const Translation3dZero: Translation3d = [0, 0, 0];
export const Rotation3dZero: Rotation3d = [1, 0, 0, 0];
export const Pose3dZero: Pose3d = {
  translation: Translation3dZero,
  rotation: Rotation3dZero
};

export type AnnotatedPose2d = {
  pose: Pose2d;
  annotation: PoseAnnotations;
};
export type AnnotatedPose3d = {
  pose: Pose3d;
  annotation: PoseAnnotations;
};
export type PoseAnnotations = {
  is2DSource: boolean;
  aprilTagId?: number;
  visionColor?: string;
  visionSize?: string;
};

export type SwerveState = { speed: number; angle: Rotation2d };
export type ChassisSpeeds = { vx: number; vy: number; omega: number };

export const APRIL_TAG_36H11_COUNT = 587;
export const APRIL_TAG_16H5_COUNT = 30;
export const APRIL_TAG_36H11_SIZE = Units.convert(8.125, "inches", "meters");
export const APRIL_TAG_16H5_SIZE = Units.convert(8, "inches", "meters");
export const HEATMAP_DT = 0.25;

// FORMAT CONVERSION UTILITIES

export function translation2dTo3d(input: Translation2d): Translation3d {
  return [...input, 0];
}

export function translation3dTo2d(input: Translation3d): Translation2d {
  return [input[0], input[1]];
}

export function rotation2dTo3d(input: Rotation2d): Rotation3d {
  // https://en.wikipedia.org/wiki/Conversion_between_quaternions_and_Euler_angles#Euler_angles_to_quaternion_conversion
  return [Math.cos(input * 0.5), 0, 0, Math.sin(input * 0.5)];
}

export function rotation3dTo2d(input: Rotation3d): Rotation2d {
  // https://en.wikipedia.org/wiki/Conversion_between_quaternions_and_Euler_angles#Quaternion_to_Euler_angles_(in_3-2-1_sequence)_conversion
  return Math.atan2(
    2.0 * (input[0] * input[3] + input[1] * input[2]),
    1.0 - 2.0 * (input[2] * input[2] + input[3] * input[3])
  );
}

export function rotation3dToRPY(input: Rotation3d): [number, number, number] {
  let w = input[0];
  let x = input[1];
  let y = input[2];
  let z = input[3];

  let roll = 0;
  let pitch = 0;
  let yaw = 0;

  // wpimath/algorithms.md
  {
    let cxcy = 1.0 - 2.0 * (x * x + y * y);
    let sxcy = 2.0 * (w * x + y * z);
    let cy_sq = cxcy * cxcy + sxcy * sxcy;
    if (cy_sq > 1e-20) {
      roll = Math.atan2(sxcy, cxcy);
    }
  }
  {
    let ratio = 2.0 * (w * y - z * x);
    if (Math.abs(ratio) >= 1.0) {
      pitch = (Math.PI / 2.0) * Math.sign(ratio);
    } else {
      pitch = Math.asin(ratio);
    }
  }
  {
    let cycz = 1.0 - 2.0 * (y * y + z * z);
    let cysz = 2.0 * (w * z + x * y);
    let cy_sq = cycz * cycz + cysz * cysz;
    if (cy_sq > 1e-20) {
      yaw = Math.atan2(cysz, cycz);
    } else {
      yaw = Math.atan2(2.0 * w * z, w * w - z * z);
    }
  }
  return [roll, pitch, yaw];
}

export function pose2dTo3d(input: Pose2d): Pose3d {
  return {
    translation: translation2dTo3d(input.translation),
    rotation: rotation2dTo3d(input.rotation)
  };
}

export function pose3dTo2d(input: Pose3d): Pose2d {
  return {
    translation: translation3dTo2d(input.translation),
    rotation: rotation3dTo2d(input.rotation)
  };
}

export function annotatedPose2dTo3d(input: AnnotatedPose2d): AnnotatedPose3d {
  return {
    pose: {
      translation: translation2dTo3d(input.pose.translation),
      rotation: rotation2dTo3d(input.pose.rotation)
    },
    annotation: input.annotation
  };
}

export function annotatedPose3dTo2d(input: AnnotatedPose3d): AnnotatedPose2d {
  return {
    pose: {
      translation: translation3dTo2d(input.pose.translation),
      rotation: rotation3dTo2d(input.pose.rotation)
    },
    annotation: input.annotation
  };
}

// COORDINATE SYSTEM CONVERSION

export function convertFromCoordinateSystem<PoseType extends Pose2d | AnnotatedPose2d | Pose2d[] | AnnotatedPose2d[]>(
  pose: PoseType,
  sourceCoordinateSystem: CoordinateSystem,
  currentAlliance: "red" | "blue",
  fieldLength: number,
  fieldWidth: number
): PoseType {
  if (Array.isArray(pose)) {
    return pose.map((x) =>
      convertFromCoordinateSystem(x, sourceCoordinateSystem, currentAlliance, fieldLength, fieldWidth)
    ) as PoseType;
  } else if ("annotation" in pose) {
    return {
      pose: convertFromCoordinateSystem(pose.pose, sourceCoordinateSystem, currentAlliance, fieldLength, fieldWidth),
      annotation: pose.annotation
    } as PoseType;
  } else {
    switch (sourceCoordinateSystem) {
      case "wall-alliance":
        switch (currentAlliance) {
          case "blue":
            return {
              translation: [fieldLength / 2 - pose.translation[0], fieldWidth / 2 - pose.translation[1]],
              rotation: pose.rotation + Math.PI
            } as PoseType;
          case "red":
            return {
              translation: [pose.translation[0] - fieldLength / 2, pose.translation[1] - fieldWidth / 2],
              rotation: pose.rotation
            } as PoseType;
        }
      case "wall-blue":
        return {
          translation: [fieldLength / 2 - pose.translation[0], fieldWidth / 2 - pose.translation[1]],
          rotation: pose.rotation + Math.PI
        } as PoseType;
      case "center-rotated":
        return {
          translation: [pose.translation[1], -pose.translation[0]],
          rotation: pose.rotation - Math.PI / 2
        } as PoseType;
      default:
        return pose;
    }
  }
}

// LOG READING UTILITIES

export function grabPosesAuto(
  log: Log,
  key: string,
  logType: string,
  timestamp: number,
  uuid?: string,
  numberRotationUnits?: "radians" | "degrees"
): AnnotatedPose3d[] {
  switch (logType) {
    case "Number":
      return grabNumberRotation(log, key, timestamp, numberRotationUnits, uuid);
    case "Rotation2d":
      return grabRotation2d(log, key, timestamp, uuid);
    case "Rotation3d":
      return grabRotation3d(log, key, timestamp, uuid);
    case "Rotation2d[]":
      return grabRotation2dArray(log, key, timestamp, uuid);
    case "Rotation3d[]":
      return grabRotation3dArray(log, key, timestamp, uuid);
    case "TargetCorner:16f6ac0dedc8eaccb951f4895d9e18b6[]":
      return grabTargetCornerArray(log, key, timestamp, uuid);
    case "Translation2d":
      return grabTranslation2d(log, key, timestamp, uuid);
    case "Translation3d":
      return grabTranslation3d(log, key, timestamp, uuid);
    case "Translation2d[]":
      return grabTranslation2dArray(log, key, timestamp, uuid);
    case "Translation3d[]":
      return grabTranslation3dArray(log, key, timestamp, uuid);
    case "Pose2d":
    case "Transform2d":
      return grabPose2d(log, key, timestamp, uuid);
    case "Pose3d":
    case "Transform3d":
      return grabPose3d(log, key, timestamp, uuid);
    case "Pose2d[]":
    case "Transform2d[]":
      return grabPose2dArray(log, key, timestamp, uuid);
    case "Pose3d[]":
    case "Transform3d[]":
      return grabPose3dArray(log, key, timestamp, uuid);
    case "Trajectory":
      return grabTrajectory(log, key, timestamp, uuid);
    case "DifferentialSample[]":
    case "SwerveSample[]":
      return grabChoreoSampleArray(log, key, timestamp, uuid);
    default:
      return [];
  }
}

export function grabNumberRotation(
  log: Log,
  key: string,
  timestamp: number,
  unit?: "radians" | "degrees",
  uuid?: string
): AnnotatedPose3d[] {
  let value = getOrDefault(log, key, LoggableType.Number, timestamp, 0, uuid);
  if (unit === "degrees") {
    value = Units.convert(value, "degrees", "radians");
  }
  return [
    {
      pose: {
        translation: Translation3dZero,
        rotation: rotation2dTo3d(value)
      },
      annotation: {
        is2DSource: true
      }
    }
  ];
}

export function grabRotation2d(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return [
    {
      pose: {
        translation: Translation3dZero,
        rotation: rotation2dTo3d(getOrDefault(log, key + "/value", LoggableType.Number, timestamp, 0, uuid))
      },
      annotation: {
        is2DSource: true
      }
    }
  ];
}

export function grabRotation3d(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return [
    {
      pose: {
        translation: Translation3dZero,
        rotation: [
          getOrDefault(log, key + "/q/w", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/q/x", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/q/y", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/q/z", LoggableType.Number, timestamp, 0, uuid)
        ]
      },
      annotation: { is2DSource: false }
    }
  ];
}

export function grabRotation2dArray(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return indexArray(getOrDefault(log, key + "/length", LoggableType.Number, timestamp, 0, uuid)).reduce(
    (array, index) => array.concat(grabRotation2d(log, key + "/" + index.toString(), timestamp)),
    [] as AnnotatedPose3d[]
  );
}

export function grabRotation3dArray(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return indexArray(getOrDefault(log, key + "/length", LoggableType.Number, timestamp, 0, uuid)).reduce(
    (array, index) => array.concat(grabRotation3d(log, key + "/" + index.toString(), timestamp)),
    [] as AnnotatedPose3d[]
  );
}

export function grabTargetCornerArray(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return indexArray(getOrDefault(log, key + "/length", LoggableType.Number, timestamp, 0, uuid)).reduce(
    (array, index) => array.concat(grabTargetCorner(log, key + "/" + index.toString(), timestamp)),
    [] as AnnotatedPose3d[]
  );
}

export function grabTargetCorner(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return [
    {
      pose: {
        translation: translation2dTo3d([
          getOrDefault(log, key + "/x", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/y", LoggableType.Number, timestamp, 0, uuid)
        ]),
        rotation: Rotation3dZero
      },
      annotation: { is2DSource: true }
    }
  ];
}

export function grabTranslation2d(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return [
    {
      pose: {
        translation: translation2dTo3d([
          getOrDefault(log, key + "/x", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/y", LoggableType.Number, timestamp, 0, uuid)
        ]),
        rotation: Rotation3dZero
      },
      annotation: { is2DSource: true }
    }
  ];
}

export function grabTranslation3d(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return [
    {
      pose: {
        translation: [
          getOrDefault(log, key + "/x", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/y", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/z", LoggableType.Number, timestamp, 0, uuid)
        ],
        rotation: Rotation3dZero
      },
      annotation: { is2DSource: false }
    }
  ];
}

export function grabTranslation2dArray(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return indexArray(getOrDefault(log, key + "/length", LoggableType.Number, timestamp, 0, uuid)).reduce(
    (array, index) => array.concat(grabTranslation2d(log, key + "/" + index.toString(), timestamp)),
    [] as AnnotatedPose3d[]
  );
}

export function grabTranslation3dArray(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return indexArray(getOrDefault(log, key + "/length", LoggableType.Number, timestamp, 0, uuid)).reduce(
    (array, index) => array.concat(grabTranslation3d(log, key + "/" + index.toString(), timestamp)),
    [] as AnnotatedPose3d[]
  );
}

export function grabPose2d(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return [
    {
      pose: pose2dTo3d({
        translation: [
          getOrDefault(log, key + "/translation/x", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/translation/y", LoggableType.Number, timestamp, 0, uuid)
        ],
        rotation: getOrDefault(log, key + "/rotation/value", LoggableType.Number, timestamp, 0, uuid)
      }),
      annotation: { is2DSource: true }
    }
  ];
}

export function grabChoreoSample(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return [
    {
      pose: pose2dTo3d({
        translation: [
          getOrDefault(log, key + "/pose/translation/x", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/pose/translation/y", LoggableType.Number, timestamp, 0, uuid)
        ],
        rotation: getOrDefault(log, key + "/pose/rotation/value", LoggableType.Number, timestamp, 0, uuid)
      }),
      annotation: { is2DSource: true }
    }
  ];
}

export function grabPose3d(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return [
    {
      pose: {
        translation: [
          getOrDefault(log, key + "/translation/x", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/translation/y", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/translation/z", LoggableType.Number, timestamp, 0, uuid)
        ],
        rotation: [
          getOrDefault(log, key + "/rotation/q/w", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/rotation/q/x", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/rotation/q/y", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/rotation/q/z", LoggableType.Number, timestamp, 0, uuid)
        ]
      },
      annotation: { is2DSource: false }
    }
  ];
}

export function grabPose2dArray(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return indexArray(getOrDefault(log, key + "/length", LoggableType.Number, timestamp, 0, uuid)).reduce(
    (array, index) => array.concat(grabPose2d(log, key + "/" + index.toString(), timestamp)),
    [] as AnnotatedPose3d[]
  );
}

export function grabChoreoSampleArray(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return indexArray(getOrDefault(log, key + "/length", LoggableType.Number, timestamp, 0, uuid)).reduce(
    (array, index) => array.concat(grabChoreoSample(log, key + "/" + index.toString(), timestamp)),
    [] as AnnotatedPose3d[]
  );
}

export function grabPose3dArray(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return indexArray(getOrDefault(log, key + "/length", LoggableType.Number, timestamp, 0, uuid)).reduce(
    (array, index) => array.concat(grabPose3d(log, key + "/" + index.toString(), timestamp)),
    [] as AnnotatedPose3d[]
  );
}

export function grabTrajectory(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return indexArray(getOrDefault(log, key + "/states/length", LoggableType.Number, timestamp, 0, uuid)).reduce(
    (array, index) => array.concat(grabPose3d(log, key + "/states/" + index.toString() + "/pose", timestamp)),
    [] as AnnotatedPose3d[]
  );
}

export function grabAprilTag(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return [
    {
      pose: {
        translation: [
          getOrDefault(log, key + "/pose/translation/x", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/pose/translation/y", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/pose/translation/z", LoggableType.Number, timestamp, 0, uuid)
        ],
        rotation: [
          getOrDefault(log, key + "/pose/rotation/q/w", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/pose/rotation/q/x", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/pose/rotation/q/y", LoggableType.Number, timestamp, 0, uuid),
          getOrDefault(log, key + "/pose/rotation/q/z", LoggableType.Number, timestamp, 0, uuid)
        ]
      },
      annotation: {
        aprilTagId: getOrDefault(log, key + "/ID", LoggableType.Number, timestamp, undefined, uuid),
        is2DSource: false
      }
    }
  ];
}

export function grabAprilTagArray(log: Log, key: string, timestamp: number, uuid?: string): AnnotatedPose3d[] {
  return indexArray(getOrDefault(log, key + "/length", LoggableType.Number, timestamp, 0, uuid)).reduce(
    (array, index) => array.concat(grabAprilTag(log, key + "/" + index.toString(), timestamp)),
    [] as AnnotatedPose3d[]
  );
}

export function grabHeatmapData(
  log: Log,
  key: string,
  logType: string,
  timeRange: "enabled" | "auto" | "teleop" | "teleop-no-endgame" | "full" | "visible",
  uuid?: string
): AnnotatedPose3d[] {
  let poses: AnnotatedPose3d[] = [];
  let isFullLog = timeRange === "full";
  let stateRanges = isFullLog ? null : getRobotStateRanges(log);
  let isValid = (timestamp: number) => {
    if (isFullLog) return true;
    if (stateRanges === null) return false;
    let currentRange = stateRanges.findLast((range) => range.start <= timestamp);
    switch (timeRange) {
      case "enabled":
        return currentRange?.mode !== "disabled";
      case "auto":
        return currentRange?.mode === "auto";
      case "teleop":
        return currentRange?.mode === "teleop";
      case "teleop-no-endgame":
        return currentRange?.mode === "teleop" && currentRange?.end !== undefined && currentRange?.end - timestamp > 30;
      case "visible":
        const timelineRange = window.selection.getTimelineRange();
        return timestamp >= timelineRange[0] && timestamp <= timelineRange[1];
    }
  };
  for (let sampleTime = log.getTimestampRange()[0]; sampleTime < log.getTimestampRange()[1]; sampleTime += HEATMAP_DT) {
    if (!isValid(sampleTime)) continue;
    poses = poses.concat(grabPosesAuto(log, key, logType, sampleTime, uuid));
  }
  return poses;
}

export function grabSwerveStates(
  log: Log,
  key: string,
  timestamp: number,
  arrangement?: string,
  uuid?: string
): SwerveState[] {
  let states: SwerveState[] = [];
  let length = getOrDefault(log, key + "/length", LoggableType.Number, timestamp, 0, uuid);
  for (let i = 0; i < length; i++) {
    states.push({
      speed: getOrDefault(log, key + "/" + i.toString() + "/speed", LoggableType.Number, timestamp, 0, uuid),
      angle: getOrDefault(log, key + "/" + i.toString() + "/angle/value", LoggableType.Number, timestamp, 0, uuid)
    });
  }

  // Apply arrangement
  if (states.length === 4 && arrangement !== undefined) {
    let originalStates = jsonCopy(states);
    arrangement
      .split(",")
      .map((x) => Number(x))
      .forEach((sourceIndex, targetIndex) => {
        states[targetIndex] = originalStates[sourceIndex];
      });
  }

  return states;
}

export function grabChassisSpeeds(log: Log, key: string, timestamp: number, uuid?: string): ChassisSpeeds {
  return {
    vx: getOrDefault(log, key + "/vx", LoggableType.Number, timestamp, 0, uuid),
    vy: getOrDefault(log, key + "/vy", LoggableType.Number, timestamp, 0, uuid),
    omega: getOrDefault(log, key + "/omega", LoggableType.Number, timestamp, 0, uuid)
  };
}
