/**
 * 排练问题（RehearsalIssue）数据模型
 * 记录试排时锣鼓点与影人动作不合拍的位置、偏差秒数和现场情况。
 */

export type IssueTimingDirection = 'early' | 'late';
export type RehearsalIssueStatus = 'open' | 'resolved';

export interface IssueOccurrence {
  /** 第几次在同一处出现 */
  count: number;
  /** 本次记录时间（ISO 字符串） */
  recordedAt: string;
  /** 本次偏差方向：鼓点相对影人动作早到 / 晚到 */
  timingDirection: IssueTimingDirection;
  /** 偏差秒数 */
  offsetSeconds: number;
  /** 本次现场情况 */
  situation: string;
}

export interface IssueResolutionNote {
  /** 处理或补充说明时间（ISO 字符串） */
  notedAt: string;
  /** 舞台监督留下的处理说明 */
  note: string;
}

export interface RehearsalIssue {
  /** 主键，uuid */
  id: string;
  /** 所属场次 id */
  sceneId: string;
  /** 关联锣鼓点 id；鼓点被删后保留为 null */
  cueId: string | null;
  /** 记录时的锣鼓点名快照，删点后仍可辨认原记录 */
  cueBeatName: string;
  /** 记录时的秒点快照 */
  cueAtSecond: number;
  /** 涉及影人的角色 id 列表 */
  roleIds: string[];
  /** 记录时的角色名快照，角色删除或换名后仍保留 */
  roleNames: string[];
  /** 当前状态 */
  status: RehearsalIssueStatus;
  /** 同一处历次出现情况 */
  occurrences: IssueOccurrence[];
  /** 处理后在原记录上补写的说明 */
  resolutionNotes: IssueResolutionNote[];
  /** 首次创建时间（ISO 字符串） */
  createdAt: string;
  /** 最近修改时间（ISO 字符串） */
  updatedAt: string;
}

export interface IssueDraft {
  cueId: string;
  roleIds: string[];
  timingDirection: IssueTimingDirection;
  offsetSeconds: number;
  situation: string;
}

export interface IssueResolutionDraft {
  note: string;
}

export const ISSUE_TIMING_OPTIONS: ReadonlyArray<{ value: IssueTimingDirection; label: string }> = [
  { value: 'early', label: '鼓点早到' },
  { value: 'late', label: '鼓点晚到' },
];

export const ISSUE_TIMING_LABEL: Record<IssueTimingDirection, string> = {
  early: '鼓点早到',
  late: '鼓点晚到',
};

export function describeIssueTiming(direction: IssueTimingDirection, seconds: number): string {
  return `${ISSUE_TIMING_LABEL[direction]} ${Math.abs(seconds)} 秒`;
}

export function createEmptyIssueDraft(cueId: string): IssueDraft {
  return {
    cueId,
    roleIds: [],
    timingDirection: 'early',
    offsetSeconds: 1,
    situation: '',
  };
}
