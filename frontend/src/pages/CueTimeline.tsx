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
  ExclamationCircleOutlined,
  FileTextOutlined,
  LinkOutlined,
  PauseOutlined,
  PlusOutlined,
  ReloadOutlined,
  SoundOutlined,
  TeamOutlined,
  ThunderboltOutlined,
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
  ISSUE_TIMING_OPTIONS,
  createEmptyIssueDraft,
  describeIssueTiming,
  type IssueDraft,
  type IssueResolutionDraft,
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
  removeIssue,
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
  const [noteForm] = Form.useForm<IssueResolutionDraft>();

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
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteModalTitle, setNoteModalTitle] = useState('补记处理说明');
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [noteMode, setNoteMode] = useState<'resolve' | 'append' | 'relink'>('append');
  const [relinkCueId, setRelinkCueId] = useState<string | null>(null);

  const operators = useOperatorStore((state) => state.operators);
  const loadOperators = useOperatorStore((state) => state.loadOperators);
  const loadScenes = useSceneStore((state) => state.loadScenes);
  const updateScene = useSceneStore((state) => state.updateScene);
  const plays = usePlayStore((state) => state.plays);
  const loadPlays = usePlayStore((state) => state.loadPlays);

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
  const sortedIssues = useMemo(
    () =>
      [...issues].sort((a, b) => {
        const aTime = a.occurrences[a.occurrences.length - 1]?.recordedAt ?? a.createdAt;
        const bTime = b.occurrences[b.occurrences.length - 1]?.recordedAt ?? b.createdAt;
        return bTime.localeCompare(aTime);
      }),
    [issues],
  );
  const openIssues = useMemo(() => sortedIssues.filter((item) => item.status === 'open'), [sortedIssues]);
  const cueIssueCount = useMemo(() => {
    const map = new Map<string, number>();
    openIssues.forEach((issue) => {
      if (issue.cueId) map.set(issue.cueId, (map.get(issue.cueId) ?? 0) + 1);
    });
    return map;
  }, [openIssues]);
  const nearestCue = useMemo(() => {
    if (sortedCues.length === 0) return null;
    return sortedCues.reduce((closest, cue) =>
      Math.abs(cue.atSecond - cursorSecond) < Math.abs(closest.atSecond - cursorSecond) ? cue : closest,
    );
  }, [cursorSecond, sortedCues]);
  const cueOfIssue = useCallback(
    (issue: RehearsalIssueRow): CueRow | undefined =>
      issue.cueId ? cues.find((cue) => cue.id === issue.cueId) : undefined,
    [cues],
  );
  const issueLinkState = useCallback(
    (issue: RehearsalIssueRow): 'linked' | 'moved' | 'missing' => {
      const cue = cueOfIssue(issue);
      if (!cue) return 'missing';
      return cue.atSecond === issue.cueAtSecond ? 'linked' : 'moved';
    },
    [cueOfIssue],
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
        const movedLinkedIssueCount = issues.filter(
          (issue) => issue.cueId === target.id && issue.status === 'open' && issue.cueAtSecond !== atSecond,
        ).length;
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
        message.success('锣鼓点已更新');
        if (target.atSecond !== atSecond && movedLinkedIssueCount > 0) {
          message.warning(`${movedLinkedIssueCount} 条排练问题保留，请确认原秒点 ${secondsToTimecode(target.atSecond)} 是否需要重新挂点`);
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
    modal.confirm({
      title: `删除 ${secondsToTimecode(cue.atSecond)} 的「${BEAT_NAME_LABEL[cue.beatName]}」？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const linkedIssueCount = issues.filter((issue) => issue.cueId === cue.id).length;
        await removeCue(cue.id);
        setCues((prev) => prev.filter((item) => item.id !== cue.id));
        setIssues((prev) =>
          prev.map((issue) =>
            issue.cueId === cue.id ? { ...issue, cueId: null, updatedAt: nowIso(), revision: ROW_REVISION } : issue,
          ),
        );
        await Promise.all(
          issues
            .filter((issue) => issue.cueId === cue.id)
            .map((issue) =>
              putIssue({ ...issue, cueId: null, updatedAt: nowIso(), revision: ROW_REVISION }),
            ),
        );
        message.success(
          linkedIssueCount > 0 ? `鼓点已删除，${linkedIssueCount} 条问题保留，请重新挂点` : '鼓点已删除',
        );
      },
    });
  };

  const openIssueModal = () => {
    if (sortedCues.length === 0) {
      message.warning('本场还没有锣鼓点，请先在游标附近插入鼓点');
      return;
    }
    const cue = nearestCue ?? sortedCues[0];
    setActiveIssueId(null);
    issueForm.setFieldsValue(createEmptyIssueDraft(cue.id));
    setIssueModalOpen(true);
  };

  const openIssueModalForCue = (cue: CueRow) => {
    setActiveIssueId(null);
    setCursorSecond(cue.atSecond);
    setPlaying(false);
    issueForm.setFieldsValue(createEmptyIssueDraft(cue.id));
    setIssueModalOpen(true);
  };

  const openRecurringIssue = (issue: RehearsalIssueRow) => {
    const linkedCue = cueOfIssue(issue);
    const cue = linkedCue ?? nearestCue ?? sortedCues[0];
    if (!cue) {
      message.warning('请先重新挂一个锣鼓点');
      return;
    }
    const latest = issue.occurrences[issue.occurrences.length - 1];
    setActiveIssueId(issue.id);
    issueForm.setFieldsValue({
      cueId: cue.id,
      roleIds: issue.roleIds,
      timingDirection: latest?.timingDirection ?? 'early',
      offsetSeconds: latest?.offsetSeconds ?? 1,
      situation: '',
    });
    setIssueModalOpen(true);
  };

  const openNoteModal = (issue: RehearsalIssueRow, mode: 'resolve' | 'append' | 'relink') => {
    setActiveIssueId(issue.id);
    setNoteMode(mode);
    setNoteModalTitle(mode === 'resolve' ? '处理问题并补说明' : mode === 'relink' ? '重新挂点' : '在原记录补说明');
    setRelinkCueId(mode === 'relink' ? null : issue.cueId);
    noteForm.setFieldsValue({ note: '' });
    setNoteModalOpen(true);
  };

  const downgradeReadyScene = useCallback(async () => {
    const current = await getScene(sceneId);
    if (current && current.progress >= 100) {
      await updateScene(sceneId, { progress: 90 });
      message.warning('本场仍有未处理排练问题，进度保留为 90%，不能标成可上演');
    }
  }, [message, sceneId, updateScene]);

  const submitIssue = async () => {
    if (!nearestCue && sortedCues.length === 0) return;
    const values = await issueForm.validateFields();
    const selectedCue = cues.find((cue) => cue.id === values.cueId);
    if (!selectedCue) {
      message.warning('请选择锣鼓点');
      return;
    }
    const stamp = nowIso();
    const selectedRoles = roles.filter((role) => values.roleIds.includes(role.id));
    const existing = activeIssueId ? issues.find((issue) => issue.id === activeIssueId) : undefined;
    if (existing) {
      const relinked = existing.cueId !== selectedCue.id || existing.cueAtSecond !== selectedCue.atSecond;
      const next: RehearsalIssueRow = {
        ...existing,
        cueId: selectedCue.id,
        cueBeatName: BEAT_NAME_LABEL[selectedCue.beatName],
        cueAtSecond: selectedCue.atSecond,
        roleIds: [...new Set([...existing.roleIds, ...values.roleIds])],
        roleNames: [...new Set([...existing.roleNames, ...selectedRoles.map((role) => role.name)])],
        status: 'open',
        occurrences: [
          ...existing.occurrences,
          {
            count: existing.occurrences.length + 1,
            recordedAt: stamp,
            timingDirection: values.timingDirection,
            offsetSeconds: values.offsetSeconds,
            situation: values.situation.trim(),
          },
        ],
        resolutionNotes: relinked
          ? [
              ...existing.resolutionNotes,
              {
                notedAt: stamp,
                note: `再次出现时重新挂点到 ${secondsToTimecode(selectedCue.atSecond)}「${BEAT_NAME_LABEL[selectedCue.beatName]}」`,
              },
            ]
          : existing.resolutionNotes,
        updatedAt: stamp,
        revision: ROW_REVISION,
      };
      await putIssue(next);
      setIssues((prev) => [next, ...prev.filter((issue) => issue.id !== next.id)]);
      message.success('同一处再次出现，已在原记录追加');
    } else {
      const row: RehearsalIssueRow = {
        id: uuid(),
        sceneId,
        cueId: selectedCue.id,
        cueBeatName: BEAT_NAME_LABEL[selectedCue.beatName],
        cueAtSecond: selectedCue.atSecond,
        roleIds: [...values.roleIds],
        roleNames: selectedRoles.map((role) => role.name),
        status: 'open',
        occurrences: [
          {
            count: 1,
            recordedAt: stamp,
            timingDirection: values.timingDirection,
            offsetSeconds: values.offsetSeconds,
            situation: values.situation.trim(),
          },
        ],
        resolutionNotes: [],
        createdAt: stamp,
        updatedAt: stamp,
        revision: ROW_REVISION,
      };
      await putIssue(row);
      setIssues((prev) => [row, ...prev]);
      message.success('已记入场次时间轴，可继续排这场');
    }
    setIssueModalOpen(false);
    issueForm.resetFields();
    await downgradeReadyScene();
    await loadPlays();
  };

  const submitIssueNote = async () => {
    const target = issues.find((issue) => issue.id === activeIssueId);
    if (!target) return;
    const values = await noteForm.validateFields();
    const stamp = nowIso();
    const next: RehearsalIssueRow = {
      ...target,
      status: noteMode === 'resolve' ? 'resolved' : 'open',
      resolutionNotes: [...target.resolutionNotes, { notedAt: stamp, note: values.note.trim() }],
      updatedAt: stamp,
      revision: ROW_REVISION,
    };
    await putIssue(next);
    setIssues((prev) => prev.map((issue) => (issue.id === next.id ? next : issue)));
    message.success(noteMode === 'resolve' ? '问题已处理；如再次出现可在原记录追加' : '已在原记录补说明');
    setNoteModalOpen(false);
    noteForm.resetFields();
    if (noteMode !== 'resolve') await downgradeReadyScene();
    await loadPlays();
  };

  const relinkIssue = async (issue: RehearsalIssueRow, cue: CueRow) => {
    const stamp = nowIso();
    const next: RehearsalIssueRow = {
      ...issue,
      cueId: cue.id,
      cueBeatName: BEAT_NAME_LABEL[cue.beatName],
      cueAtSecond: cue.atSecond,
      resolutionNotes: [
        ...issue.resolutionNotes,
        { notedAt: stamp, note: `重新挂点到 ${secondsToTimecode(cue.atSecond)}「${BEAT_NAME_LABEL[cue.beatName]}」` },
      ],
      updatedAt: stamp,
      revision: ROW_REVISION,
    };
    await putIssue(next);
    setIssues((prev) => prev.map((item) => (item.id === next.id ? next : item)));
    message.success('已重新挂点');
    await loadPlays();
  };

  const submitRelink = async () => {
    const target = issues.find((issue) => issue.id === activeIssueId);
    const cue = relinkCueId ? cues.find((item) => item.id === relinkCueId) : undefined;
    if (!target || !cue) {
      message.warning('请选择要重挂的锣鼓点');
      return;
    }
    await relinkIssue(target, cue);
    setNoteModalOpen(false);
    setRelinkCueId(null);
    noteForm.resetFields();
  };

  const handleDeleteIssue = (issue: RehearsalIssueRow) => {
    modal.confirm({
      title: '删除这条排练问题？',
      content: '删除后不再进入排练通告，处理记录也会一并清除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await removeIssue(issue.id);
        setIssues((prev) => prev.filter((item) => item.id !== issue.id));
        message.success('排练问题已删除');
        await loadPlays();
      },
    });
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
      title: '锣鼓点 / 挂点',
      width: 190,
      render: (_value, record) => {
        const cue = cueOfIssue(record);
        const linkState = issueLinkState(record);
        return (
          <Space direction="vertical" size={2}>
            <Space size={4} wrap>
              <Tag color="volcano">{cue ? BEAT_NAME_LABEL[cue.beatName] : record.cueBeatName || '鼓点已删'}</Tag>
              <Tag className="gb-mono">{secondsToTimecode(record.cueAtSecond)}</Tag>
            </Space>
            {linkState === 'missing' ? (
              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                原鼓点已删除，请重新挂点
              </Typography.Text>
            ) : linkState === 'moved' ? (
              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                秒点已改为 {secondsToTimecode(cue?.atSecond ?? record.cueAtSecond)}，请确认
              </Typography.Text>
            ) : (
              <Typography.Text type="success" style={{ fontSize: 12 }}>
                已挂在当前秒点
              </Typography.Text>
            )}
          </Space>
        );
      },
    },
    {
      title: '偏差与出现',
      width: 150,
      render: (_value, record) => {
        const latest = record.occurrences[record.occurrences.length - 1];
        return (
          <Space direction="vertical" size={2}>
            <Typography.Text strong type={record.status === 'open' ? 'danger' : undefined}>
              {latest ? describeIssueTiming(latest.timingDirection, latest.offsetSeconds) : '偏差待补'}
            </Typography.Text>
            <Tag color={record.status === 'open' ? 'error' : 'success'}>
              {record.status === 'open' ? `未处理 · ${record.occurrences.length} 次` : `已处理 · ${record.occurrences.length} 次`}
            </Tag>
          </Space>
        );
      },
    },
    {
      title: '涉及影人',
      dataIndex: 'roleNames',
      width: 150,
      render: (value: string[]) => (
        <Space size={4} wrap>
          {value.length > 0 ? value.map((name) => <Tag key={name}>{name}</Tag>) : <Typography.Text type="secondary">待补</Typography.Text>}
        </Space>
      ),
    },
    {
      title: '现场情况 / 处理说明',
      render: (_value, record) => {
        const latest = record.occurrences[record.occurrences.length - 1];
        const lastNote = record.resolutionNotes[record.resolutionNotes.length - 1];
        return (
          <Space direction="vertical" size={3} style={{ width: '100%' }}>
            <Typography.Text>{latest?.situation ?? '现场情况待补'}</Typography.Text>
            {lastNote ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                处理：{lastNote.note}
              </Typography.Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'issueActions',
      width: 250,
      render: (_value, record) => (
        <Space size={4} wrap>
          {record.status === 'open' ? (
            <>
              <Button size="small" type="primary" ghost icon={<CheckCircleOutlined />} onClick={() => openNoteModal(record, 'resolve')}>
                处理
              </Button>
              <Button size="small" icon={<ExclamationCircleOutlined />} onClick={() => openRecurringIssue(record)}>
                再出现
              </Button>
            </>
          ) : (
            <Button size="small" icon={<ExclamationCircleOutlined />} onClick={() => openRecurringIssue(record)}>
              再出现
            </Button>
          )}
          <Button size="small" icon={<FileTextOutlined />} onClick={() => openNoteModal(record, 'append')}>
            补说明
          </Button>
          <Tooltip title="重新挂到本时间轴上的其他鼓点">
            <Button size="small" icon={<LinkOutlined />} onClick={() => openNoteModal(record, 'relink')} />
          </Tooltip>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteIssue(record)} />
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
  const passedCount = sortedCues.filter((cue) => cue.atSecond <= cursorSecond).length;

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
            <Button icon={<ExclamationCircleOutlined />} danger onClick={openIssueModal} disabled={cues.length === 0}>
              记排练问题
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
            <Statistic title="未处理问题" value={openIssues.length} suffix={`/ ${issues.length}`} />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="已过鼓点" value={passedCount} suffix={`/ ${cues.length}`} />
          </Col>
        </Row>
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
                      item.scene.id === sceneId ? (
                        <Space size={4}>
                          {openIssues.length > 0 ? <Tag color="error">问题 {openIssues.length}</Tag> : null}
                          <Tag color="#7a1f1f">当前</Tag>
                        </Space>
                      ) : undefined
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
                    className={cueIssueCount.has(cue.id) ? 'gb-cue-dot gb-cue-dot-issue' : 'gb-cue-dot'}
                    style={{ left: `${secondsToPercent(cue.atSecond, durationSecond)}%` }}
                    onClick={(event) => {
                      event.stopPropagation();
                      openEdit(cue);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openIssueModalForCue(cue);
                    }}
                    title={`${secondsToTimecode(cue.atSecond)} ${BEAT_NAME_LABEL[cue.beatName]}（${
                      INSTRUMENT_LABEL[cue.instrument]
                    }）点击编辑，右键记排练问题`}
                  >
                    <b className="gb-mono">{secondsToTimecode(cue.atSecond)}</b>
                    <i
                      style={{
                        background: INSTRUMENT_COLOR[cue.instrument],
                        transform: activeCueId === cue.id ? 'scale(1.6)' : 'scale(1)',
                        transition: 'transform 0.18s ease',
                      }}
                    />
                    <span style={{ color: 'rgba(43,26,18,0.7)' }}>
                      {BEAT_NAME_LABEL[cue.beatName]}·{INSTRUMENT_LABEL[cue.instrument]}
                    </span>
                    {cueIssueCount.has(cue.id) ? (
                      <em className="gb-issue-badge">{cueIssueCount.get(cue.id)}</em>
                    ) : null}
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
              <Button danger icon={<ExclamationCircleOutlined />} onClick={openIssueModal} disabled={sortedCues.length === 0}>
                记游标附近问题
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
            {openIssues.length > 0 ? (
              <Alert
                style={{ marginTop: 8 }}
                type="warning"
                showIcon
                message={`本场有 ${openIssues.length} 条排练问题未处理，仍可继续试排，但不能标成可上演`}
                description={
                  <Space direction="vertical" size={2}>
                    {openIssues.slice(0, 3).map((issue) => {
                      const latest = issue.occurrences[issue.occurrences.length - 1];
                      return (
                        <Typography.Text key={issue.id} style={{ fontSize: 12 }}>
                          {secondsToTimecode(issue.cueAtSecond)} {issue.cueBeatName} ·{' '}
                          {latest ? describeIssueTiming(latest.timingDirection, latest.offsetSeconds) : '偏差待补'} ·
                          涉及 {issue.roleNames.join('／') || '待补影人'}
                        </Typography.Text>
                      );
                    })}
                  </Space>
                }
              />
            ) : null}
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
              <Typography.Text strong>排练问题（记在场次时间轴）</Typography.Text>
              <Space size={8}>
                <Tag color="error">未处理 {openIssues.length}</Tag>
                <Tag color="success">已处理 {issues.length - openIssues.length}</Tag>
                <Button size="small" danger icon={<ExclamationCircleOutlined />} onClick={openIssueModal} disabled={cues.length === 0}>
                  从游标附近记一条
                </Button>
              </Space>
            </div>
            {issues.length === 0 ? (
              <EmptyState
                size="small"
                title="本场还没有排练问题"
                description="试排时若鼓点与影人没合上，可选择游标附近鼓点，记录早到/晚到秒数、涉及影人和现场情况。"
                actionText="记排练问题"
                onAction={openIssueModal}
              />
            ) : (
              <Table<RehearsalIssueRow>
                rowKey="id"
                size="small"
                className="gb-table-compact"
                loading={loading}
                columns={issueColumns}
                dataSource={sortedIssues}
                pagination={false}
                scroll={{ x: 980 }}
                rowClassName={(record) => (record.status === 'open' ? 'gb-issue-row-open' : 'gb-issue-row-resolved')}
                locale={{ emptyText: <Empty description="暂无排练问题" /> }}
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
        open={issueModalOpen}
        title={activeIssueId ? '同一处再次出现 · 追加排练问题' : `记排练问题（游标 ${secondsToTimecode(Math.round(cursorSecond))} 附近）`}
        okText={activeIssueId ? '追加到原记录' : '记入场次'}
        cancelText="取消"
        onCancel={() => {
          setIssueModalOpen(false);
          setActiveIssueId(null);
          issueForm.resetFields();
        }}
        onOk={() => void submitIssue()}
      >
        <Form form={issueForm} layout="vertical">
          <Form.Item
            name="cueId"
            label="锣鼓点（默认选离游标最近的一处）"
            rules={[{ required: true, message: '请选择锣鼓点' }]}
            extra="同一处可反复记录；处理后也能在原记录上继续补情况。"
          >
            <Select
              options={sortedCues.map((cue) => ({
                value: cue.id,
                label: `${secondsToTimecode(cue.atSecond)} ${BEAT_NAME_LABEL[cue.beatName]}（距游标 ${Math.abs(
                  cue.atSecond - Math.round(cursorSecond),
                )} 秒）`,
              }))}
            />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="timingDirection" label="偏差方向" rules={[{ required: true, message: '请选择方向' }]}>
                <Select options={[...ISSUE_TIMING_OPTIONS]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="offsetSeconds"
                label="相差秒数"
                rules={[
                  { required: true, message: '请填写秒数' },
                  { validator: (_rule, value: number) => (Number(value) > 0 ? Promise.resolve() : Promise.reject(new Error('秒数需大于 0'))) },
                ]}
              >
                <InputNumber min={0.1} max={durationSecond} precision={1} step={0.5} addonAfter="秒" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="roleIds" label="涉及影人" rules={[{ required: true, message: '请选择至少一位影人' }]}>
            <Select
              mode="multiple"
              placeholder="选择本场影人，可多选"
              options={roles.map((role) => ({ value: role.id, label: role.name }))}
            />
          </Form.Item>
          <Form.Item
            name="situation"
            label="现场情况"
            rules={[{ required: true, message: '请写明现场情况' }, { max: 160, message: '不超过 160 个字' }]}
          >
            <Input.TextArea rows={4} maxLength={160} showCount placeholder="如：亮相时影人还未到影窗中线，四击头末锣已落" />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            未处理期间仍可继续排这场；鼓点删除或改秒点后，这条问题会保留并提示重新挂点。
          </Typography.Text>
        </Form>
      </Modal>

      <Modal
        open={noteModalOpen}
        title={noteModalTitle}
        okText={noteMode === 'resolve' ? '标记已处理' : noteMode === 'relink' ? '重新挂点' : '补说明'}
        cancelText="取消"
        onCancel={() => {
          setNoteModalOpen(false);
          setActiveIssueId(null);
          setRelinkCueId(null);
          noteForm.resetFields();
        }}
        onOk={() => void (noteMode === 'relink' ? submitRelink() : submitIssueNote())}
      >
        {noteMode === 'relink' ? (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Typography.Text type="secondary">选择当前时间轴上仍存在的锣鼓点，原记录保留并自动补一条重挂说明。</Typography.Text>
            <Select
              value={relinkCueId}
              placeholder="选择要重挂的锣鼓点"
              options={sortedCues.map((cue) => ({
                value: cue.id,
                label: `${secondsToTimecode(cue.atSecond)} ${BEAT_NAME_LABEL[cue.beatName]} · ${INSTRUMENT_LABEL[cue.instrument]}`,
              }))}
              onChange={setRelinkCueId}
            />
          </Space>
        ) : (
          <Form form={noteForm} layout="vertical">
            <Form.Item
              name="note"
              label={noteMode === 'resolve' ? '处理说明' : '补充说明'}
              rules={[{ required: true, message: '请填写说明' }, { max: 160, message: '不超过 160 个字' }]}
            >
              <Input.TextArea rows={4} maxLength={160} showCount placeholder="如：四击头后移 2 秒，白娘子到场中线再落末锣" />
            </Form.Item>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              说明会补在原记录下；若同一处之后再出现，历史处理仍保留。
            </Typography.Text>
          </Form>
        )}
      </Modal>

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
    </Space>
  );
}
