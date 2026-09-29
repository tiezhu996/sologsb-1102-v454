/**
 * /scenes/:id/cues 锣鼓点时间轴
 * 按时秒插入鼓点并试排播放时间轴刻度；消费 PercussionCue、Scene，复用 <SceneCard>。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Select,
  Slider,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CaretRightOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  LinkOutlined,
  PauseOutlined,
  PlusOutlined,
  ReloadOutlined,
  SoundOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { SceneCard } from '../components/common/SceneCard';
import { EmptyState } from '../components/common/EmptyState';
import { useSceneOrder } from '../hooks/useSceneOrder';
import { useOperatorStore, operatorNameOf } from '../stores/operatorStore';
import { useSceneStore } from '../stores/sceneStore';
import { SKILL_TAG_LABEL } from '../types/operator';
import { usePlayStore } from '../stores/playStore';
import { ROUTES } from '../router';
import {
  BEAT_DENSITY,
  BEAT_NAME_LABEL,
  BEAT_NAME_OPTIONS,
  INSTRUMENT_COLOR,
  INSTRUMENT_LABEL,
  INSTRUMENT_OPTIONS,
  createEmptyCueDraft,
  type BeatName,
  type CueDraft,
} from '../types/cue';
import {
  ISSUE_STATUS_LABEL,
  ISSUE_TIMING_LABEL,
  createEmptyIssueDraft,
  type IssueDraft,
  type IssueTiming,
} from '../types/rehearsalIssue';
import {
  ROW_REVISION,
  getScene,
  listCuesByScene,
  listIssuesByScene,
  listRolesByScene,
  putCue,
  putIssue,
  removeCue,
  type CueRow,
  type RehearsalIssueRow,
  type RoleRow,
  type SceneRow,
} from '../utils/db';
import { buildRulerTicks, secondsToPercent, secondsToTimecode, timecodeToSeconds } from '../utils/timecode';
import { nowIso, uuid } from '../utils/uuid';

export default function CueTimeline() {
  const { id: sceneId = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<CueDraft>();
  const [issueForm] = Form.useForm<IssueDraft>();
  const [resolutionForm] = Form.useForm<{ resolutionNote: string }>();

  const [scene, setScene] = useState<SceneRow | null>(null);
  const [cues, setCues] = useState<CueRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [issues, setIssues] = useState<RehearsalIssueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursorSecond, setCursorSecond] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [followCursor, setFollowCursor] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCueId, setEditingCueId] = useState<string | null>(null);
  const [activeCueId, setActiveCueId] = useState<string | null>(null);
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [editingIssueId, setEditingIssueId] = useState<string | null>(null);
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [resolvingIssueId, setResolvingIssueId] = useState<string | null>(null);
  const [relinkIssueId, setRelinkIssueId] = useState<string | null>(null);
  const [relinkIssueFormValue, setRelinkIssueFormValue] = useState<string | null>(null);

  const operators = useOperatorStore((state) => state.operators);
  const loadOperators = useOperatorStore((state) => state.loadOperators);
  const loadScenes = useSceneStore((state) => state.loadScenes);
  const updateScene = useSceneStore((state) => state.updateScene);
  const plays = usePlayStore((state) => state.plays);

  const reload = useCallback(async () => {
    setLoading(true);
    const [sceneRow, cueRows, roleRows, issueRows] = await Promise.all([
      getScene(sceneId),
      listCuesByScene(sceneId),
      listRolesByScene(sceneId),
      listIssuesByScene(sceneId),
    ]);
    setScene(sceneRow ?? null);
    setCues(cueRows);
    setRoles(roleRows);
    setIssues(issueRows);
    setLoading(false);
    if (sceneRow) {
      await Promise.all([loadScenes(sceneRow.playId), loadOperators()]);
    }
  }, [loadOperators, loadScenes, sceneId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const {
    items,
    selectedSceneIds,
    toggleSelected,
    totalMinute,
  } = useSceneOrder(scene ? scene.playId : null);

  const play = scene ? plays.find((item) => item.id === scene.playId) ?? null : null;
  const durationSecond = scene ? Math.max(1, scene.durationMin) * 60 : 60;
  const ticks = useMemo(() => buildRulerTicks(durationSecond), [durationSecond]);
  const sortedCues = useMemo(() => [...cues].sort((a, b) => a.atSecond - b.atSecond), [cues]);
  const cueById = useMemo(() => new Map(cues.map((cue) => [cue.id, cue])), [cues]);
  const nearestCue = useMemo(() => {
    if (sortedCues.length === 0) return null;
    return sortedCues.reduce((nearest, cue) =>
      Math.abs(cue.atSecond - cursorSecond) < Math.abs(nearest.atSecond - cursorSecond) ? cue : nearest,
    );
  }, [cursorSecond, sortedCues]);
  const openIssues = useMemo(() => issues.filter((issue) => issue.status === 'open'), [issues]);
  const staleIssueIds = useMemo(() => {
    const ids = new Set<string>();
    openIssues.forEach((issue) => {
      const cue = cueById.get(issue.cueId);
      if (!cue || cue.atSecond !== issue.cueAtSecond) ids.add(issue.id);
    });
    return ids;
  }, [cueById, openIssues]);
  const issueCountByCue = useMemo(() => {
    const map = new Map<string, number>();
    openIssues.forEach((issue) => {
      map.set(issue.cueId, (map.get(issue.cueId) ?? 0) + 1);
    });
    return map;
  }, [openIssues]);
  const staleOpenIssueIds = useMemo(
    () => openIssues.filter((issue) => staleIssueIds.has(issue.id)).map((issue) => issue.id),
    [openIssues, staleIssueIds],
  );

  /** 试排播放：按秒推进游标，到时辰停止 */
  const lastFrameRef = useRef<number>(0);
  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    const step = (timestamp: number) => {
      if (lastFrameRef.current === 0) lastFrameRef.current = timestamp;
      const delta = (timestamp - lastFrameRef.current) / 1000;
      lastFrameRef.current = timestamp;
      setCursorSecond((prev) => {
        const next = prev + delta;
        if (next >= durationSecond) {
          setPlaying(false);
          return durationSecond;
        }
        return next;
      });
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => {
      lastFrameRef.current = 0;
      window.cancelAnimationFrame(raf);
    };
  }, [playing, durationSecond]);

  /** 播放到鼓点秒点时高亮该鼓点 */
  useEffect(() => {
    const passed = sortedCues.filter((cue) => cue.atSecond <= cursorSecond);
    const last = passed.length > 0 ? passed[passed.length - 1] : null;
    if (last && cursorSecond - last.atSecond < 1.6) {
      setActiveCueId(last.id);
    }
  }, [cursorSecond, sortedCues]);

  const rulerRef = useRef<HTMLDivElement | null>(null);

  /**
   * 试排时跟随游标：把时间轴容器横向滚动到游标附近。
   * 刻度较密时容器会横向溢出（min-width 由刻度数决定），滚动可让当前秒点始终可见。
   */
  useEffect(() => {
    if (!playing || !followCursor) return;
    const node = rulerRef.current;
    if (!node) return;
    const target = (cursorSecond / durationSecond) * node.scrollWidth;
    const view = node.clientWidth;
    if (target < node.scrollLeft || target > node.scrollLeft + view - 24) {
      node.scrollLeft = Math.max(0, target - view / 2);
    }
  }, [cursorSecond, durationSecond, followCursor, playing]);

  const seekByEvent = (clientX: number) => {
    const node = rulerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setCursorSecond(Math.round(ratio * durationSecond));
    setPlaying(false);
  };

  const openCreate = (atSecond?: number) => {
    setEditingCueId(null);
    form.setFieldsValue(createEmptyCueDraft(atSecond ?? cursorSecond) as CueDraft);
    setModalOpen(true);
  };

  const openEdit = (cue: CueRow) => {
    setEditingCueId(cue.id);
    form.setFieldsValue({
      beatName: cue.beatName,
      instrument: cue.instrument,
      atSecond: cue.atSecond,
      leadOperator: cue.leadOperator,
      note: cue.note,
    });
    setModalOpen(true);
  };

  const submitCue = async () => {
    const values = await form.validateFields();
    const stamp = nowIso();
    const atSecond = Math.max(0, Math.min(durationSecond, Math.round(values.atSecond)));
    if (editingCueId) {
      const target = cues.find((cue) => cue.id === editingCueId);
      if (target) {
        const secondChanged = target.atSecond !== atSecond;
        const next: CueRow = {
          ...target,
          beatName: values.beatName,
          instrument: values.instrument,
          atSecond,
          leadOperator: values.leadOperator,
          note: values.note.trim(),
          updatedAt: stamp,
          revision: ROW_REVISION,
        };
        await putCue(next);
        setCues((prev) => prev.map((cue) => (cue.id === next.id ? next : cue)));
        if (secondChanged) {
          const linkedCount = openIssues.filter((issue) => issue.cueId === target.id).length;
          message.warning(
            linkedCount > 0
              ? `秒点已改动，${linkedCount} 条排练问题保留，请重新挂点确认`
              : '锣鼓点已更新；秒点变化不会改动历史排练问题',
          );
        } else {
          message.success('锣鼓点已更新');
        }
      }
    } else {
      const row: CueRow = {
        id: uuid(),
        sceneId,
        beatName: values.beatName,
        instrument: values.instrument,
        atSecond,
        leadOperator: values.leadOperator,
        note: values.note.trim(),
        createdAt: stamp,
        updatedAt: stamp,
        revision: ROW_REVISION,
      };
      await putCue(row);
      setCues((prev) => [...prev, row]);
      message.success(`已在 ${secondsToTimecode(atSecond)} 插入「${BEAT_NAME_LABEL[row.beatName]}」`);
    }
    setModalOpen(false);
  };

  const handleDelete = (cue: CueRow) => {
    const linkedOpenCount = openIssues.filter((issue) => issue.cueId === cue.id).length;
    modal.confirm({
      title: `删除 ${secondsToTimecode(cue.atSecond)} 的「${BEAT_NAME_LABEL[cue.beatName]}」？`,
      content:
        linkedOpenCount > 0
          ? `有 ${linkedOpenCount} 条未处理排练问题会保留，并标记为待重新挂点。`
          : '历史排练问题不会随鼓点删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await removeCue(cue.id);
        setCues((prev) => prev.filter((item) => item.id !== cue.id));
        message.success(linkedOpenCount > 0 ? '鼓点已删除，排练问题待重新挂点' : '鼓点已删除');
      },
    });
  };

  const openIssueCreate = () => {
    if (!nearestCue) {
      message.warning('本场还没有锣鼓点，请先插入鼓点再记排练问题');
      return;
    }
    if (roles.length === 0) {
      message.warning('本场还没有影人，请先到角色指派页登记涉及影人');
      return;
    }
    setEditingIssueId(null);
    const draft = createEmptyIssueDraft(nearestCue.id, roles[0]?.id ?? null);
    issueForm.setFieldsValue(draft);
    setIssueModalOpen(true);
  };

  const openIssueRepeat = (issue: RehearsalIssueRow) => {
    setEditingIssueId(issue.id);
    issueForm.setFieldsValue({
      cueId: issue.cueId,
      roleId: issue.roleId,
      timing: issue.timing,
      offsetSeconds: issue.offsetSeconds,
      situation: '',
    });
    setIssueModalOpen(true);
  };

  const buildIssueSnapshot = (cue: CueRow) => ({
    cueBeatName: BEAT_NAME_LABEL[cue.beatName],
    cueInstrument: INSTRUMENT_LABEL[cue.instrument],
    cueAtSecond: cue.atSecond,
  });

  const submitIssue = async () => {
    const values = await issueForm.validateFields();
    if (!scene) return;
    const cue = cues.find((item) => item.id === values.cueId);
    if (!cue) {
      message.warning('所选锣鼓点已不存在，请重新挂点');
      return;
    }
    const role = roles.find((item) => item.id === values.roleId) ?? null;
    if (!role) {
      message.warning('请重新选择涉及影人');
      return;
    }
    const stamp = nowIso();
    const timing: IssueTiming = values.timing;
    const offsetSeconds = Math.max(0.5, Math.round(Math.abs(values.offsetSeconds) * 2) / 2);
    const situation = values.situation.trim();
    const occurrence = {
      id: uuid(),
      cursorSecond: Math.round(cursorSecond),
      timing,
      offsetSeconds,
      situation,
      recordedAt: stamp,
    };

    if (editingIssueId) {
      const target = issues.find((issue) => issue.id === editingIssueId);
      if (!target) return;
      const next: RehearsalIssueRow = {
        ...target,
        ...buildIssueSnapshot(cue),
        cueId: cue.id,
        roleId: role.id,
        roleName: role.name,
        timing,
        offsetSeconds,
        situation,
        occurrences: [...target.occurrences, occurrence],
        status: 'open',
        resolvedAt: null,
        updatedAt: stamp,
        revision: ROW_REVISION,
      };
      await putIssue(next);
      setIssues((prev) => [next, ...prev.filter((issue) => issue.id !== next.id)]);
      message.success('同一处问题已追加新的现场记录');
    } else {
      const row: RehearsalIssueRow = {
        id: uuid(),
        sceneId,
        cueId: cue.id,
        ...buildIssueSnapshot(cue),
        roleId: role.id,
        roleName: role.name,
        timing,
        offsetSeconds,
        situation,
        occurrences: [occurrence],
        status: 'open',
        resolutionNotes: [],
        resolvedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
        revision: ROW_REVISION,
      };
      await putIssue(row);
      setIssues((prev) => [row, ...prev]);
      message.success('排练问题已记入场次时间轴');
    }
    if (scene.progress >= 100) {
      await updateScene(scene.id, { progress: 99 });
      setScene((prev) => (prev ? { ...prev, progress: 99 } : prev));
      message.warning('本场存在未处理问题，不能标成可上演，已调整为 99%');
    }
    setIssueModalOpen(false);
    issueForm.resetFields();
  };

  const openResolve = (issue: RehearsalIssueRow) => {
    setResolvingIssueId(issue.id);
    resolutionForm.setFieldsValue({ resolutionNote: '' });
    setResolutionOpen(true);
  };

  const submitResolution = async () => {
    const values = await resolutionForm.validateFields();
    const target = issues.find((issue) => issue.id === resolvingIssueId);
    if (!target) return;
    const stamp = nowIso();
    const next: RehearsalIssueRow = {
      ...target,
      status: 'resolved',
      resolvedAt: stamp,
      resolutionNotes: [...target.resolutionNotes, { id: uuid(), note: values.resolutionNote.trim(), createdAt: stamp }],
      updatedAt: stamp,
      revision: ROW_REVISION,
    };
    await putIssue(next);
    setIssues((prev) => [next, ...prev.filter((issue) => issue.id !== next.id)]);
    setResolutionOpen(false);
    setResolvingIssueId(null);
    resolutionForm.resetFields();
    message.success('已在原记录补处理说明');
  };

  const relinkIssue = async (nextCueId: string) => {
    const target = issues.find((issue) => issue.id === relinkIssueId);
    const cue = cues.find((item) => item.id === nextCueId);
    if (!target || !cue) return;
    const stamp = nowIso();
    const next: RehearsalIssueRow = {
      ...target,
      cueId: cue.id,
      ...buildIssueSnapshot(cue),
      updatedAt: stamp,
      revision: ROW_REVISION,
    };
    await putIssue(next);
    setIssues((prev) => [next, ...prev.filter((issue) => issue.id !== next.id)]);
    setRelinkIssueId(null);
    message.success('排练问题已重新挂到该锣鼓点');
  };

  const columns: ColumnsType<CueRow> = [
    {
      title: '秒点',
      dataIndex: 'atSecond',
      width: 96,
      sorter: (a, b) => a.atSecond - b.atSecond,
      defaultSortOrder: 'ascend',
      render: (value: number, record) => (
        <Space size={4}>
          <Tag color="#7a1f1f" className="gb-mono">
            {secondsToTimecode(value)}
          </Tag>
          <Tooltip title="把试排游标移到该鼓点">
            <Button
              size="small"
              type="text"
              onClick={() => {
                setCursorSecond(value);
                setPlaying(false);
              }}
            >
              <CaretRightOutlined />
            </Button>
          </Tooltip>
          {activeCueId === record.id ? <Tag color="gold">当前</Tag> : null}
          {(issueCountByCue.get(record.id) ?? 0) > 0 ? (
            <Tooltip title="该鼓点有未处理排练问题">
              <Tag color="error" icon={<WarningOutlined />}>
                {issueCountByCue.get(record.id)} 问题
              </Tag>
            </Tooltip>
          ) : null}
        </Space>
      ),
    },
    {
      title: '锣鼓点名',
      dataIndex: 'beatName',
      width: 120,
      filters: BEAT_NAME_OPTIONS.map((option) => ({ text: option.label, value: option.value })),
      onFilter: (value, record) => record.beatName === value,
      render: (value: BeatName) => <Tag color="volcano">{BEAT_NAME_LABEL[value]}</Tag>,
    },
    {
      title: '乐器',
      dataIndex: 'instrument',
      width: 110,
      render: (value: CueRow['instrument']) => (
        <Tag color={INSTRUMENT_COLOR[value]} style={{ color: '#fffdf8' }}>
          {INSTRUMENT_LABEL[value]}
        </Tag>
      ),
    },
    {
      title: '领奏操耍人',
      dataIndex: 'leadOperator',
      width: 200,
      render: (value: string | null, record) => (
        <Select<string | null>
          size="small"
          style={{ width: '100%' }}
          value={value}
          allowClear
          placeholder="选择领奏"
          options={operators.map((operator) => ({ value: operator.id, label: operator.name }))}
          onChange={async (next) => {
            const target = cues.find((cue) => cue.id === record.id);
            if (!target) return;
            const updated: CueRow = { ...target, leadOperator: next ?? null, updatedAt: nowIso(), revision: ROW_REVISION };
            await putCue(updated);
            setCues((prev) => prev.map((cue) => (cue.id === updated.id ? updated : cue)));
          }}
        />
      ),
    },
    {
      title: '备注',
      dataIndex: 'note',
      render: (value: string, record) => (
        <Input
          size="small"
          value={value}
          placeholder="如：水漫起势 / 与铙钹同落"
          onChange={async (event) => {
            const target = cues.find((cue) => cue.id === record.id);
            if (!target) return;
            const updated: CueRow = { ...target, note: event.target.value, updatedAt: nowIso(), revision: ROW_REVISION };
            setCues((prev) => prev.map((cue) => (cue.id === updated.id ? updated : cue)));
          }}
          onBlur={async (event) => {
            const target = cues.find((cue) => cue.id === record.id);
            if (!target) return;
            await putCue({ ...target, note: event.target.value, updatedAt: nowIso(), revision: ROW_REVISION });
          }}
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      render: (_value, record) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)} />
        </Space>
      ),
    },
  ];

  const issueColumns: ColumnsType<RehearsalIssueRow> = [
    {
      title: '挂点 / 偏差',
      key: 'cue',
      width: 210,
      render: (_value, record) => {
        const linkedCue = cueById.get(record.cueId);
        const stale = staleIssueIds.has(record.id);
        return (
          <Space direction="vertical" size={3}>
            <Space size={4} wrap>
              <Tag color={stale ? 'error' : '#7a1f1f'} className="gb-mono">
                {secondsToTimecode(record.cueAtSecond)}
              </Tag>
              <Tag color="volcano">{record.cueBeatName}</Tag>
              {stale ? <Tag color="error">待重新挂点</Tag> : null}
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {record.cueInstrument}
              {linkedCue && linkedCue.atSecond !== record.cueAtSecond
                ? `，现秒点 ${secondsToTimecode(linkedCue.atSecond)}`
                : !linkedCue
                  ? '，原鼓点已删除'
                  : ''}
            </Typography.Text>
            <Space size={4}>
              <Tag color={record.timing === 'early' ? 'orange' : 'blue'}>
                {ISSUE_TIMING_LABEL[record.timing]} {record.offsetSeconds} 秒
              </Tag>
              <Tag>出现 {record.occurrences.length} 次</Tag>
            </Space>
          </Space>
        );
      },
    },
    {
      title: '影人 / 现场情况',
      key: 'detail',
      render: (_value, record) => (
        <Space direction="vertical" size={3} style={{ width: '100%' }}>
          <Space size={4} wrap>
            <Tag color="magenta">{record.roleName || '未指定影人'}</Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              最近记录游标 {secondsToTimecode(record.occurrences.at(-1)?.cursorSecond ?? record.cueAtSecond)}
            </Typography.Text>
          </Space>
          <Typography.Text>{record.situation}</Typography.Text>
          {record.resolutionNotes.length > 0 ? (
            <Typography.Text type="success" style={{ fontSize: 12 }}>
              处理：{record.resolutionNotes.at(-1)?.note}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '状态 / 操作',
      key: 'issueActions',
      width: 240,
      render: (_value, record) => (
        <Space direction="vertical" size={6}>
          <Tag color={record.status === 'open' ? 'error' : 'success'}>{ISSUE_STATUS_LABEL[record.status]}</Tag>
          <Space size={4} wrap>
            <Button size="small" icon={<HistoryOutlined />} onClick={() => openIssueRepeat(record)}>
              再记一次
            </Button>
            {record.status === 'open' ? (
              <Button size="small" type="primary" ghost icon={<CheckCircleOutlined />} onClick={() => openResolve(record)}>
                处理
              </Button>
            ) : null}
            <Button
              size="small"
              icon={<LinkOutlined />}
              disabled={sortedCues.length === 0}
              onClick={() => {
                setRelinkIssueId(record.id);
                setRelinkIssueFormValue(cueById.has(record.cueId) ? record.cueId : nearestCue?.id ?? null);
              }}
            >
              重新挂点
            </Button>
          </Space>
        </Space>
      ),
    },
  ];

  if (!loading && !scene) {
    return (
      <div className="gb-panel">
        <EmptyState
          title="未找到该场次"
          description="场次可能已随剧目删除，请回到剧目库重新选择。"
          actionText="回到剧目库"
          onAction={() => navigate(ROUTES.plays)}
        />
      </div>
    );
  }

  const sceneIndex = items.findIndex((item) => item.scene.id === sceneId);
  const prevItem = sceneIndex > 0 ? items[sceneIndex - 1] : null;
  const nextItem = sceneIndex >= 0 && sceneIndex < items.length - 1 ? items[sceneIndex + 1] : null;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="gb-panel">
        <div className="gb-panel-title">
          <Space size={10} wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => scene && navigate(ROUTES.scenes(scene.playId))}>
              场次拆分
            </Button>
            <Typography.Title level={4} style={{ margin: 0 }}>
              锣鼓点时间轴{scene ? ` · 第 ${scene.seq} 场 ${scene.title}` : ''}
            </Typography.Title>
            {play ? <Tag color="#7a1f1f">{play.title}</Tag> : null}
            <Tag color="gold">整剧合计 {totalMinute} 分钟</Tag>
          </Space>
          <Space wrap>
            <Button icon={<PlusOutlined />} type="primary" onClick={() => openCreate()}>
              在游标处插入鼓点
            </Button>
            <Button danger ghost icon={<WarningOutlined />} disabled={cues.length === 0} onClick={openIssueCreate}>
              记录排练问题
            </Button>
            <Button
              icon={<TeamOutlined />}
              disabled={!scene}
              onClick={() => scene && navigate(ROUTES.roles(scene.id))}
            >
              角色指派
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>
              重新载入
            </Button>
          </Space>
        </div>

        <Row gutter={16}>
          <Col xs={12} md={6}>
            <Statistic title="本场时长" value={scene?.durationMin ?? 0} suffix="分钟" />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="锣鼓点数量" value={cues.length} suffix="处" />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="试排游标" value={secondsToTimecode(cursorSecond)} className="gb-mono" />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="未处理排练问题" value={openIssues.length} suffix={`/ ${issues.length}`} />
          </Col>
        </Row>
        {openIssues.length > 0 ? (
          <Alert
            style={{ marginTop: 12 }}
            type={staleOpenIssueIds.length > 0 ? 'error' : 'warning'}
            showIcon
            icon={<WarningOutlined />}
            message={
              staleOpenIssueIds.length > 0
                ? `${staleOpenIssueIds.length} 条问题需要重新挂点；本场可继续排，但不能标成可上演。`
                : `本场有 ${openIssues.length} 条未处理排练问题；处理完后才可标记可上演。`
            }
            description={staleOpenIssueIds.length > 0 ? '原锣鼓点已删除或秒点已改动，历史记录已保留。' : '同一处问题可在记录中反复追加，处理说明会补在原记录上。'}
          />
        ) : null}
      </div>

      <Row gutter={16}>
        <Col xs={24} lg={9}>
          <div className="gb-panel">
            <div className="gb-panel-title">
              <Typography.Text strong>本剧场序（点击切换场次时间轴）</Typography.Text>
              <Tag>{selectedSceneIds.length} 场勾选</Tag>
            </div>
            <div className="gb-scene-list">
              {items.length === 0 ? (
                <EmptyState
                  size="small"
                  title="还没有场次"
                  description="先到场次拆分页建立场次。"
                  actionText="去拆场次"
                  onAction={() => play && navigate(ROUTES.scenes(play.id))}
                />
              ) : (
                items.map((item) => (
                  <SceneCard
                    key={item.scene.id}
                    scene={item.scene}
                    startTimecode={item.startTimecode}
                    endTimecode={item.endTimecode}
                    cueCount={item.scene.id === sceneId ? cues.length : 0}
                    roleCount={0}
                    selected={selectedSceneIds.includes(item.scene.id)}
                    selectable
                    compact
                    onToggleSelect={() => toggleSelected(item.scene.id)}
                    onOpen={() => navigate(ROUTES.cues(item.scene.id))}
                    extraActions={
                      item.scene.id === sceneId ? <Tag color="#7a1f1f">当前</Tag> : undefined
                    }
                  />
                ))
              )}
            </div>
          </div>
        </Col>

        <Col xs={24} lg={15}>
          <div className="gb-panel">
            <div className="gb-panel-title">
              <Space size={10} wrap>
                <Typography.Text strong>试排时间轴刻度</Typography.Text>
                <Tag className="gb-mono">
                  {secondsToTimecode(Math.floor(cursorSecond))} / {secondsToTimecode(durationSecond)}
                </Tag>
              </Space>
              <Space wrap>
                <Button
                  type="primary"
                  icon={playing ? <PauseOutlined /> : <CaretRightOutlined />}
                  onClick={() => {
                    if (cursorSecond >= durationSecond) setCursorSecond(0);
                    setPlaying((prev) => !prev);
                  }}
                >
                  {playing ? '暂停试排' : '开始试排'}
                </Button>
                <Button
                  onClick={() => {
                    setPlaying(false);
                    setCursorSecond(0);
                  }}
                >
                  回到开头
                </Button>
                <Space size={4}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    随游标滚动
                  </Typography.Text>
                  <Switch size="small" checked={followCursor} onChange={setFollowCursor} />
                </Space>
              </Space>
            </div>

            <div
              ref={rulerRef}
              style={{ overflowX: 'auto', overflowY: 'hidden', paddingBottom: 4 }}
            >
              <div
                className="gb-ruler"
                style={{ minWidth: Math.max(560, Math.round(durationSecond * 3.2)) }}
                onClick={(event) => seekByEvent(event.clientX)}
                title="点击刻度可定位试排游标"
              >
                {ticks.map((tick) => (
                  <div key={tick} className="gb-ruler-tick" style={{ left: `${secondsToPercent(tick, durationSecond)}%` }}>
                    <span className="gb-mono">{secondsToTimecode(tick)}</span>
                  </div>
                ))}
                {sortedCues.map((cue) => (
                  <div
                    key={cue.id}
                    className={`gb-cue-dot ${(issueCountByCue.get(cue.id) ?? 0) > 0 ? 'has-issue' : ''}`}
                    style={{ left: `${secondsToPercent(cue.atSecond, durationSecond)}%` }}
                    onClick={(event) => {
                      event.stopPropagation();
                      openEdit(cue);
                    }}
                    title={`${secondsToTimecode(cue.atSecond)} ${BEAT_NAME_LABEL[cue.beatName]}（${
                      INSTRUMENT_LABEL[cue.instrument]
                    }）点击编辑`}
                  >
                    <b className="gb-mono">{secondsToTimecode(cue.atSecond)}</b>
                    <i
                      style={{
                        background: INSTRUMENT_COLOR[cue.instrument],
                        transform: activeCueId === cue.id ? 'scale(1.6)' : 'scale(1)',
                        transition: 'transform 0.18s ease',
                      }}
                    />
                    {(issueCountByCue.get(cue.id) ?? 0) > 0 ? (
                      <em className="gb-cue-issue gb-mono">!</em>
                    ) : null}
                    <span style={{ color: 'rgba(43,26,18,0.7)' }}>
                      {BEAT_NAME_LABEL[cue.beatName]}·{INSTRUMENT_LABEL[cue.instrument]}
                    </span>
                  </div>
                ))}
                <div className="gb-playhead" style={{ left: `${secondsToPercent(cursorSecond, durationSecond)}%` }} />
              </div>
            </div>

            <Space style={{ width: '100%', marginTop: 12 }} wrap>
              <Typography.Text type="secondary">游标定位</Typography.Text>
              <InputNumber
                min={0}
                max={durationSecond}
                value={Math.round(cursorSecond)}
                onChange={(value) => {
                  setPlaying(false);
                  setCursorSecond(typeof value === 'number' ? value : 0);
                }}
                addonAfter="秒"
                style={{ width: 140 }}
              />
              <Input
                style={{ width: 120 }}
                placeholder="mm:ss"
                onPressEnter={(event) => {
                  const parsed = timecodeToSeconds(event.currentTarget.value);
                  if (Number.isNaN(parsed)) {
                    message.warning('时间码格式应为 mm:ss，例如 01:20');
                    return;
                  }
                  setPlaying(false);
                  setCursorSecond(Math.min(durationSecond, parsed));
                  message.success(`游标已定位到 ${secondsToTimecode(parsed)}`);
                }}
              />
              <Button icon={<ThunderboltOutlined />} onClick={() => openCreate(Math.round(cursorSecond))}>
                在游标 {secondsToTimecode(Math.round(cursorSecond))} 插点
              </Button>
              <Button danger ghost icon={<WarningOutlined />} disabled={!nearestCue} onClick={openIssueCreate}>
                记游标附近问题{nearestCue ? ` · ${BEAT_NAME_LABEL[nearestCue.beatName]}` : ''}
              </Button>
              {followCursor && sortedCues.length > 0 ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  最近鼓点：
                  {(() => {
                    const passed = sortedCues.filter((cue) => cue.atSecond <= cursorSecond);
                    const nearest = passed.length > 0 ? passed[passed.length - 1] : null;
                    return nearest
                      ? `${secondsToTimecode(nearest.atSecond)} ${BEAT_NAME_LABEL[nearest.beatName]}（${
                          INSTRUMENT_LABEL[nearest.instrument]
                        }）`
                      : '尚未进入首个鼓点';
                  })()}
                </Typography.Text>
              ) : null}
            </Space>

            <div style={{ marginTop: 8 }}>
              <Slider
                min={0}
                max={durationSecond}
                value={Math.round(cursorSecond)}
                tooltip={{ formatter: (value) => secondsToTimecode(typeof value === 'number' ? value : 0) }}
                onChange={(value) => {
                  setPlaying(false);
                  setCursorSecond(value);
                }}
              />
            </div>
          </div>

          <div className="gb-panel" style={{ marginTop: 16 }}>
            <div className="gb-panel-title">
              <Typography.Text strong>鼓点清单（按秒点对齐场次时间轴）</Typography.Text>
              <Space size={8}>
                <Tag color="gold">共 {cues.length} 处</Tag>
                {cues.length > 0 ? (
                  <Tag>
                    平均间隔{' '}
                    {cues.length > 1
                      ? secondsToTimecode(
                          Math.round(
                            (sortedCues[sortedCues.length - 1].atSecond - sortedCues[0].atSecond) / (cues.length - 1),
                          ),
                        )
                      : '—'}
                  </Tag>
                ) : null}
              </Space>
            </div>

            {cues.length === 0 ? (
              <EmptyState
                title="本场还没有锣鼓点"
                description="点击时间轴定位秒点，再插入急急风、四击头或水底鱼，试排时可跟着刻度走。"
                actionText={`在 ${secondsToTimecode(Math.round(cursorSecond))} 插入鼓点`}
                onAction={() => openCreate(Math.round(cursorSecond))}
                extra={
                  <Space size={6} wrap>
                    {BEAT_NAME_OPTIONS.map((option) => (
                      <Tag key={option.value} color="volcano">
                        {option.label} · 约 {BEAT_DENSITY[option.value]} 拍/分
                      </Tag>
                    ))}
                  </Space>
                }
              />
            ) : (
              <Table<CueRow>
                rowKey="id"
                size="small"
                className="gb-table-compact"
                loading={loading}
                columns={columns}
                dataSource={sortedCues}
                pagination={false}
                rowClassName={(record) => (activeCueId === record.id ? 'gb-row-active' : '')}
                locale={{ emptyText: <Empty description="暂无鼓点" /> }}
              />
            )}
          </div>

          <div className="gb-panel" style={{ marginTop: 16 }}>
            <div className="gb-panel-title">
              <Space size={8} wrap>
                <Typography.Text strong>排练问题（挂在场次时间轴）</Typography.Text>
                <Tag color="error">未处理 {openIssues.length}</Tag>
                <Tag>全部 {issues.length}</Tag>
              </Space>
              <Button danger ghost size="small" icon={<WarningOutlined />} disabled={cues.length === 0} onClick={openIssueCreate}>
                从游标附近记一条
              </Button>
            </div>
            {issues.length === 0 ? (
              <EmptyState
                size="small"
                title="还没有排练问题"
                description="试排时若鼓点和影人动作没合上，选择游标附近锣鼓点，记录早到/晚到几秒、涉及影人和现场情况。"
                actionText="记录第一条"
                onAction={openIssueCreate}
              />
            ) : (
              <Table<RehearsalIssueRow>
                rowKey="id"
                size="small"
                className="gb-table-compact"
                loading={loading}
                columns={issueColumns}
                dataSource={issues}
                pagination={false}
                expandable={{
                  expandedRowRender: (record) => (
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      <Typography.Text strong>同一处反复出现记录</Typography.Text>
                      {record.occurrences.map((occurrence) => (
                        <Typography.Text key={occurrence.id} style={{ fontSize: 12 }}>
                          {occurrence.recordedAt}｜游标 {secondsToTimecode(occurrence.cursorSecond)}｜
                          {ISSUE_TIMING_LABEL[occurrence.timing]} {occurrence.offsetSeconds} 秒｜{occurrence.situation}
                        </Typography.Text>
                      ))}
                      {record.resolutionNotes.map((note) => (
                        <Typography.Text key={note.id} type="success" style={{ fontSize: 12 }}>
                          处理说明（{note.createdAt}）：{note.note}
                        </Typography.Text>
                      ))}
                    </Space>
                  ),
                }}
                rowClassName={(record) => (staleIssueIds.has(record.id) ? 'gb-issue-stale' : '')}
              />
            )}
          </div>

          <div className="gb-panel" style={{ marginTop: 16 }}>
            <Row gutter={12}>
              <Col xs={24} md={12}>
                <Card size="small" title="场次衔接">
                  <Space wrap>
                    <Button
                      icon={<ArrowLeftOutlined />}
                      disabled={!prevItem}
                      onClick={() => prevItem && navigate(ROUTES.cues(prevItem.scene.id))}
                    >
                      上一场{prevItem ? `：${prevItem.scene.title}` : ''}
                    </Button>
                    <Button
                      icon={<ArrowRightOutlined />}
                      disabled={!nextItem}
                      onClick={() => nextItem && navigate(ROUTES.cues(nextItem.scene.id))}
                    >
                      下一场{nextItem ? `：${nextItem.scene.title}` : ''}
                    </Button>
                  </Space>
                  <Typography.Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
                    本场自 {secondsToTimecode(0)} 起算，上一场收在{' '}
                    {prevItem ? secondsToTimecode(prevItem.startSecond + prevItem.durationSecond) : '—'}；
                    整剧累计 {totalMinute} 分钟。
                  </Typography.Paragraph>
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card size="small" title="领奏分工">
                  {operators.length === 0 ? (
                    <Empty description="操耍人档为空" />
                  ) : (
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      {operators.map((operator) => {
                        const leadCount = sortedCues.filter((cue) => cue.leadOperator === operator.id).length;
                        return (
                          <Space key={operator.id} size={8} wrap>
                            <Tag color={leadCount > 0 ? '#7a1f1f' : 'default'}>{operator.name}</Tag>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              领奏 {leadCount} 处
                            </Typography.Text>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              技能：
                              {operator.skillTags.length > 0 ? operator.skillTags.map((tag) => SKILL_TAG_LABEL[tag]).join('／') : '未标注'}
                            </Typography.Text>
                          </Space>
                        );
                      })}
                    </Space>
                  )}
                </Card>
              </Col>
            </Row>
            <Alert
              style={{ marginTop: 12 }}
              type="info"
              showIcon
              icon={<SoundOutlined />}
              message={`当前游标 ${secondsToTimecode(Math.floor(cursorSecond))}：${
                sortedCues.filter((cue) => cue.atSecond <= cursorSecond).length
              } 处鼓点已过，剩余 ${
                sortedCues.filter((cue) => cue.atSecond > cursorSecond).length
              } 处待走。`}
              description={
                sortedCues.filter((cue) => cue.atSecond > cursorSecond).length > 0
                  ? `下一处：${secondsToTimecode(
                      sortedCues.filter((cue) => cue.atSecond > cursorSecond)[0].atSecond,
                    )} ${
                      BEAT_NAME_LABEL[sortedCues.filter((cue) => cue.atSecond > cursorSecond)[0].beatName]
                    }，领奏 ${
                      operatorNameOf(
                        operators,
                        sortedCues.filter((cue) => cue.atSecond > cursorSecond)[0].leadOperator,
                      )
                    }。`
                  : '本场鼓点已全部走完，可继续下一场编排。'
              }
            />
          </div>
        </Col>
      </Row>

      <Modal
        open={modalOpen}
        title={editingCueId ? '编辑锣鼓点' : `插入锣鼓点（${secondsToTimecode(cursorSecond)} 附近）`}
        okText={editingCueId ? '保存' : '插入'}
        cancelText="取消"
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        onOk={() => void submitCue()}
      >
        <Form form={form} layout="vertical" initialValues={createEmptyCueDraft(cursorSecond) as CueDraft}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="beatName" label="锣鼓点名" rules={[{ required: true, message: '请选择锣鼓点' }]}>
                <Select options={[...BEAT_NAME_OPTIONS]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="instrument" label="主奏乐器" rules={[{ required: true, message: '请选择乐器' }]}>
                <Select options={[...INSTRUMENT_OPTIONS]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="atSecond"
            label={`出场秒点（本场 0 - ${durationSecond} 秒）`}
            rules={[{ required: true, message: '请填写秒点' }]}
          >
            <InputNumber min={0} max={durationSecond} style={{ width: '100%' }} addonAfter="秒" />
          </Form.Item>
          <Form.Item name="leadOperator" label="领奏操耍人">
            <Select
              allowClear
              placeholder="可稍后再指定"
              options={operators.map((operator) => ({
                value: operator.id,
                label: `${operator.name}（已派 ${operator.assignedRoleIds.length} 个角色）`,
              }))}
            />
          </Form.Item>
          <Form.Item name="note" label="备注" rules={[{ max: 80, message: '不超过 80 个字' }]}>
            <Input.TextArea rows={3} placeholder="如：法海逼近，急急风催台" maxLength={80} showCount />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            提示：急急风适合开打与催台，四击头用于亮相，水底鱼多作垫场与转场。
          </Typography.Text>
        </Form>
      </Modal>

      <Modal
        open={issueModalOpen}
        title={editingIssueId ? '同一处再出现一次' : `记录排练问题（游标 ${secondsToTimecode(Math.floor(cursorSecond))} 附近）`}
        okText={editingIssueId ? '追加记录' : '记入时间轴'}
        cancelText="取消"
        onCancel={() => {
          setIssueModalOpen(false);
          setEditingIssueId(null);
          issueForm.resetFields();
        }}
        onOk={() => void submitIssue()}
      >
        <Form form={issueForm} layout="vertical">
          <Form.Item name="cueId" label="锣鼓点（默认选游标附近最近一处）" rules={[{ required: true, message: '请选择锣鼓点' }]}>
            <Select
              options={[...sortedCues]
                .sort(
                  (a, b) =>
                    Math.abs(a.atSecond - cursorSecond) - Math.abs(b.atSecond - cursorSecond) ||
                    a.atSecond - b.atSecond,
                )
                .map((cue) => {
                  const distance = Math.abs(cue.atSecond - cursorSecond);
                  const prefix = cue.id === nearestCue?.id ? '游标最近 · ' : `距游标 ${Math.round(distance)} 秒 · `;
                  return {
                    value: cue.id,
                    label: `${prefix}${secondsToTimecode(cue.atSecond)} ${BEAT_NAME_LABEL[cue.beatName]} · ${INSTRUMENT_LABEL[cue.instrument]}`,
                  };
                })}
            />
          </Form.Item>
          <Form.Item name="roleId" label="涉及影人" rules={[{ required: true, message: '请选择涉及影人' }]}>
            <Select
              placeholder="选择本场影人"
              options={roles.map((role) => ({ value: role.id, label: `${role.name}（${role.operatorId ? '已指派操耍人' : '未指派'}）` }))}
            />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="timing" label="偏差方向" rules={[{ required: true, message: '请选择方向' }]}>
                <Radio.Group
                  optionType="button"
                  buttonStyle="solid"
                  options={[
                    { value: 'early', label: '鼓点早到' },
                    { value: 'late', label: '鼓点晚到' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="offsetSeconds"
                label="相差秒数"
                rules={[{ required: true, message: '请填写秒数' }]}
              >
                <InputNumber min={0.5} max={60} step={0.5} addonAfter="秒" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="situation" label="现场情况" rules={[{ required: true, message: '写明现场情况，散场后可对照修改' }, { max: 160, message: '不超过 160 个字' }]}>
            <Input.TextArea
              rows={4}
              maxLength={160}
              showCount
              placeholder="如：白娘子起伞慢半拍，影件在左杆上挂了一下，四击头先落。"
            />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            同一处可反复记录；未处理时本场仍可继续排，但不能标成可上演。
          </Typography.Text>
        </Form>
      </Modal>

      <Modal
        open={resolutionOpen}
        title="处理排练问题"
        okText="补说明并标记已处理"
        cancelText="取消"
        onCancel={() => {
          setResolutionOpen(false);
          setResolvingIssueId(null);
          resolutionForm.resetFields();
        }}
        onOk={() => void submitResolution()}
      >
        <Form form={resolutionForm} layout="vertical">
          <Form.Item
            name="resolutionNote"
            label="处理说明（补在原记录）"
            rules={[{ required: true, message: '请填写如何处理' }, { max: 160, message: '不超过 160 个字' }]}
          >
            <Input.TextArea rows={4} maxLength={160} showCount placeholder="如：已把四击头后移 1 秒，并提醒操耍人提前起伞，下轮合乐通过。" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={relinkIssueId !== null}
        title="重新挂锣鼓点"
        okText="挂到所选鼓点"
        cancelText="取消"
        onCancel={() => setRelinkIssueId(null)}
        onOk={() => {
          const selected = relinkIssueFormValue;
          if (selected) void relinkIssue(selected);
        }}
      >
        {(() => {
          const target = issues.find((issue) => issue.id === relinkIssueId);
          if (!target) return null;
          return (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Typography.Text>
                原记录：{secondsToTimecode(target.cueAtSecond)} {target.cueBeatName}，{target.roleName || '未指定影人'}。
              </Typography.Text>
              <Select
                style={{ width: '100%' }}
                placeholder="选择现有的锣鼓点"
                value={relinkIssueFormValue}
                onChange={setRelinkIssueFormValue}
                options={sortedCues.map((cue) => ({
                  value: cue.id,
                  label: `${secondsToTimecode(cue.atSecond)} ${BEAT_NAME_LABEL[cue.beatName]} · ${INSTRUMENT_LABEL[cue.instrument]}`,
                }))}
              />
            </Space>
          );
        })()}
      </Modal>
    </Space>
  );
}
