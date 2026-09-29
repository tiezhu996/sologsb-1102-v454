/**
 * 导出工具：整库 JSON 存档、排练通告 CSV、文本复制
 * 全部在浏览器本地完成，不经过任何服务端。
 */
import type { Play } from '../types/play';
import type { Scene } from '../types/scene';
import type { ShadowRole } from '../types/role';
import type { Operator } from '../types/operator';
import type { PercussionCue } from '../types/cue';
import type { RehearsalIssue } from '../types/rehearsalIssue';
import { describeIssueTiming } from '../types/rehearsalIssue';
import { secondsToTimecode } from './timecode';
import { BEAT_NAME_LABEL, INSTRUMENT_LABEL } from '../types/cue';
import { ROLE_TYPE_LABEL, PROP_PART_LABEL } from '../types/role';
import { PLAY_GENRE_LABEL, PLAY_STATUS_LABEL } from '../types/play';
import { SHADOW_SCREEN_LABEL } from '../types/scene';
import { SKILL_TAG_LABEL, minuteToClock, WEEKDAY_LABEL } from '../types/operator';

/** 触发浏览器下载 */
function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** 时间戳文件名片段 */
function stampSuffix(): string {
  const date = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export interface ExportBundle {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  plays: Play[];
  scenes: Scene[];
  roles: ShadowRole[];
  operators: Operator[];
  cues: PercussionCue[];
  rehearsalIssues: RehearsalIssue[];
}

/** 导出整库 JSON 存档 */
export function exportBundleJson(bundle: ExportBundle): string {
  const filename = `gbshadowplay-backup-${stampSuffix()}.json`;
  download(filename, JSON.stringify(bundle, null, 2), 'application/json;charset=utf-8');
  return filename;
}

/** CSV 单元格转义 */
function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 单剧目排练通告导出为 CSV */
export function exportPlayCsv(
  play: Play,
  scenes: Scene[],
  roles: ShadowRole[],
  cues: PercussionCue[],
  operators: Operator[],
  issues: RehearsalIssue[] = [],
): string {
  const operatorName = (id: string | null): string => {
    if (id === null) return '待指派';
    return operators.find((item) => item.id === id)?.name ?? '（已解绑）';
  };

  const header = [
    '场序',
    '场次',
    '时长(分钟)',
    '影窗规格',
    '排练进度(%)',
    '角色',
    '行当',
    '影件',
    '操耍人',
    '锣鼓点',
    '乐器',
    '秒点',
    '领奏',
  ];
  const lines: string[] = [];
  lines.push(csvCell(`剧目：${play.title}`));
  lines.push(csvCell(`剧种：${PLAY_GENRE_LABEL[play.genre]}`));
  lines.push(csvCell(`状态：${PLAY_STATUS_LABEL[play.status]}`));
  lines.push(csvCell(`首演戏台：${play.premiereVenue || '未定'}`));
  lines.push('');
  lines.push(header.map(csvCell).join(','));

  [...scenes]
    .sort((a, b) => a.seq - b.seq)
    .forEach((scene) => {
      const sceneRoles = roles.filter((role) => role.sceneId === scene.id);
      const sceneCues = cues.filter((cue) => cue.sceneId === scene.id).sort((a, b) => a.atSecond - b.atSecond);
      const rowCount = Math.max(sceneRoles.length, sceneCues.length, 1);
      for (let index = 0; index < rowCount; index += 1) {
        const role = sceneRoles[index];
        const cue = sceneCues[index];
        lines.push(
          [
            index === 0 ? scene.seq : '',
            index === 0 ? scene.title : '',
            index === 0 ? scene.durationMin : '',
            index === 0 ? SHADOW_SCREEN_LABEL[scene.needsShadowScreen] : '',
            index === 0 ? scene.progress : '',
            role ? role.name : '',
            role ? ROLE_TYPE_LABEL[role.roleType] : '',
            role ? role.propParts.map((part) => PROP_PART_LABEL[part]).join('／') || '无需拆件' : '',
            role ? operatorName(role.operatorId) : '',
            cue ? BEAT_NAME_LABEL[cue.beatName] : '',
            cue ? INSTRUMENT_LABEL[cue.instrument] : '',
            cue ? secondsToTimecode(cue.atSecond) : '',
            cue ? operatorName(cue.leadOperator) : '',
          ]
            .map(csvCell)
            .join(','),
        );
      }
    });

  const sceneMap = new Map(scenes.map((scene) => [scene.id, scene]));
  const openIssues = issues.filter((issue) => issue.status === 'open');
  if (openIssues.length > 0) {
    lines.push('');
    lines.push(csvCell(`\u672A\u5904\u7406\u6392\u7EC3\u95EE\u9898\u6E05\u5355\uFF08${openIssues.length} \u6761\uFF1B\u672A\u6E05\u96F6\u524D\u4E0D\u80FD\u6807\u6210\u53EF\u4E0A\u6F14\uFF09`));
    lines.push(
      ['\u573A\u5E8F', '\u573A\u6B21', '\u9523\u9F13\u70B9', '\u539F\u79D2\u70B9', '\u5F53\u524D\u79D2\u70B9', '\u504F\u5DEE', '\u6D89\u53CA\u5F71\u4EBA', '\u73B0\u573A\u60C5\u51B5', '\u6302\u70B9\u72B6\u6001']
        .map(csvCell)
        .join(','),
    );
    openIssues.forEach((issue) => {
      const issueScene = sceneMap.get(issue.sceneId);
      const linkedCue = issue.cueId ? cues.find((cue) => cue.id === issue.cueId) : undefined;
      const latest = issue.occurrences[issue.occurrences.length - 1];
      const cueLabel = linkedCue ? BEAT_NAME_LABEL[linkedCue.beatName] : issue.cueBeatName || '\uFF08\u9F13\u70B9\u5DF2\u5220\uFF09';
      const linkStatus = !linkedCue
        ? '\u539F\u9F13\u70B9\u5DF2\u5220\u9664\uFF0C\u8BF7\u91CD\u65B0\u6302\u70B9'
        : linkedCue.atSecond !== issue.cueAtSecond
          ? `\u79D2\u70B9\u5DF2\u6539\u4E3A ${secondsToTimecode(linkedCue.atSecond)}\uFF0C\u8BF7\u786E\u8BA4/\u91CD\u65B0\u6302\u70B9`
          : '\u5DF2\u6302\u70B9';
      lines.push(
        [
          issueScene ? issueScene.seq : '\u573A\u6B21\u5DF2\u5220',
          issueScene ? issueScene.title : '\uFF08\u5DF2\u5220\u573A\u6B21\uFF09',
          cueLabel,
          secondsToTimecode(issue.cueAtSecond),
          linkedCue ? secondsToTimecode(linkedCue.atSecond) : '',
          latest ? describeIssueTiming(latest.timingDirection, latest.offsetSeconds) : '',
          issue.roleNames.join('\uFF0F'),
          latest ? latest.situation : '',
          linkStatus,
        ]
          .map(csvCell)
          .join(','),
      );
    });
  }

  return `\uFEFF${lines.join('\n')}`;
}

/** 导出排练通告 CSV */
export function exportPlayCsvFile(
  play: Play,
  scenes: Scene[],
  roles: ShadowRole[],
  cues: PercussionCue[],
  operators: Operator[],
  issues: RehearsalIssue[] = [],
): string {
  const filename = `${play.title}-排练通告-${stampSuffix()}.csv`;
  download(filename, exportPlayCsv(play, scenes, roles, cues, operators, issues), 'text/csv;charset=utf-8');
  return filename;
}

/** 操耍人档导出为 CSV（含技能、冲突时段、已派角色数） */
export function exportOperatorCsvFile(operators: Operator[], roles: ShadowRole[]): string {
  const header = ['姓名', '技能标签', '累计排练时长(小时)', '已派角色数', '已派角色', '冲突时段'];
  const lines = [header.map(csvCell).join(',')];
  operators.forEach((operator) => {
    const bound = roles.filter((role) => operator.assignedRoleIds.includes(role.id));
    const slots = operator.busySlots
      .map(
        (slot) =>
          `${WEEKDAY_LABEL[slot.weekday]} ${minuteToClock(slot.startMinute)}-${minuteToClock(
            slot.startMinute + slot.durationMinute,
          )} ${slot.label}`,
      )
      .join('；');
    lines.push(
      [
        operator.name,
        operator.skillTags.map((tag) => SKILL_TAG_LABEL[tag]).join('／') || '未标注',
        operator.rehearsalHours,
        bound.length,
        bound.map((role) => role.name).join('／'),
        slots || '无',
      ]
        .map(csvCell)
        .join(','),
    );
  });
  const filename = `操耍人档-${stampSuffix()}.csv`;
  download(filename, `\uFEFF${lines.join('\n')}`, 'text/csv;charset=utf-8');
  return filename;
}

/** 复制文本到剪贴板，返回是否成功 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** 生成可复制的排练通告纯文本 */
export function buildCallSheetText(
  play: Play,
  scenes: Scene[],
  roles: ShadowRole[],
  operators: Operator[],
  cues: PercussionCue[] = [],
  issues: RehearsalIssue[] = [],
): string {
  const operatorName = (id: string | null): string =>
    id === null ? '待指派' : operators.find((item) => item.id === id)?.name ?? '（已解绑）';
  const lines: string[] = [];
  lines.push(`【${play.title}】排练通告（${PLAY_GENRE_LABEL[play.genre]} · ${PLAY_STATUS_LABEL[play.status]}）`);
  lines.push(`首演戏台：${play.premiereVenue || '未定'}`);
  [...scenes]
    .sort((a, b) => a.seq - b.seq)
    .forEach((scene) => {
      const sceneRoles = roles.filter((role) => role.sceneId === scene.id);
      lines.push(
        `第${scene.seq}场 ${scene.title}｜${scene.durationMin}分钟｜${SHADOW_SCREEN_LABEL[scene.needsShadowScreen]}｜进度 ${scene.progress}%`,
      );
      sceneRoles.forEach((role) => {
        lines.push(
          `  · ${role.name}（${ROLE_TYPE_LABEL[role.roleType]}）操耍：${operatorName(role.operatorId)}｜影件：${
            role.propParts.map((part) => PROP_PART_LABEL[part]).join('／') || '无需拆件'
          }`,
        );
      });
    });
  const openIssues = issues.filter((issue) => issue.status === 'open');
  if (openIssues.length > 0) {
    const sceneMap = new Map(scenes.map((scene) => [scene.id, scene]));
    lines.push('');
    lines.push(`未处理排练问题（${openIssues.length} 条；未清零前不能标成可上演）`);
    openIssues.forEach((issue) => {
      const scene = sceneMap.get(issue.sceneId);
      const linkedCue = issue.cueId ? cues.find((cue) => cue.id === issue.cueId) : undefined;
      const latest = issue.occurrences[issue.occurrences.length - 1];
      const cueLabel = linkedCue ? BEAT_NAME_LABEL[linkedCue.beatName] : issue.cueBeatName || '（鼓点已删）';
      const linkStatus = !linkedCue
        ? '鼓点已删，需重新挂点'
        : linkedCue.atSecond !== issue.cueAtSecond
          ? `秒点已改为 ${secondsToTimecode(linkedCue.atSecond)}，需确认/重新挂点`
          : '已挂点';
      lines.push(
        `  · 第${scene ? scene.seq : '?'}场 ${scene ? scene.title : '（场次已删）'}｜${cueLabel}｜原 ${secondsToTimecode(
          issue.cueAtSecond,
        )}｜${latest ? describeIssueTiming(latest.timingDirection, latest.offsetSeconds) : '偏差待补'}｜影人：${
          issue.roleNames.join('／') || '待补'
        }｜${latest ? latest.situation : '现场情况待补'}｜${linkStatus}`,
      );
    });
  }
  return lines.join('\n');
}
