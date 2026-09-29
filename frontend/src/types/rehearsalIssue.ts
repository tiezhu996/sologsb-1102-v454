/**
 * 排练问题（RehearsalIssue）数据模型
 * 记录试排时锣鼓点与影人动作没有合上的偏差；同一处问题可反复追加发生记录。
 */

/** 鼓点相对影人动作：早到 / 晚到 */
export type IssueTiming = 'early' | 'late';

export type IssueStatus = 'open' | 'resolved';

/** 一次重复出现的现场记录 */
export interface RehearsalOccurrence {
  id: string;
  /** 记录时的试排游标秒点 */
  cursorSecond: number;
  timing: IssueTiming;
  /** 偏差秒数，始终为正数；方向由 timing 表示 */
  offsetSeconds: number;
  situation: string;
  recordedAt: string;
}

/** 处理后补在原问题上的说明 */
export interface IssueResolutionNote {
  id: string;
  note: string;
  createdAt: string;
}

export interface RehearsalIssue {
  id: string;
  sceneId: string;
  /** 所挂锣鼓点 id；鼓点删除后仍保留原 id，待重新挂点 */
  cueId: string;
  /** 记录时的锣鼓点快照，鼓点删除后仍可展示 */
  cueBeatName: string;
  cueInstrument: string;
  cueAtSecond: number;
  /** 涉及的影人角色 id */
  roleId: string | null;
  /** 角色名快照，角色被删后仍能读出来 */
  roleName: string;
  /** 最近一次偏差方向 */
  timing: IssueTiming;
  /** 最近一次偏差秒数 */
  offsetSeconds: number;
  /** 最近一次现场情况 */
  situation: string;
  occurrences: RehearsalOccurrence[];
  status: IssueStatus;
  resolutionNotes: IssueResolutionNote[];
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type IssueDraft = Pick<
  RehearsalIssue,
  'cueId' | 'roleId' | 'timing' | 'offsetSeconds' | 'situation'
>;

export const ISSUE_TIMING_LABEL: Record<IssueTiming, string> = {
  early: '鼓点早到',
  late: '鼓点晚到',
};

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  open: '未处理',
  resolved: '已处理',
};

export function signedOffset(timing: IssueTiming, offsetSeconds: number): number {
  return timing === 'early' ? -Math.abs(offsetSeconds) : Math.abs(offsetSeconds);
}

export function createEmptyIssueDraft(cueId: string, roleId: string | null): IssueDraft {
  return {
    cueId,
    roleId,
    timing: 'early',
    offsetSeconds: 1,
    situation: '',
  };
}
