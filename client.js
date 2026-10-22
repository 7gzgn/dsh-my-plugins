/**
 * dsh-my-plugins — client half.
 *
 * 顶部一颗小药丸：「我装的插件 · N」。点开是一整份清单：
 * 每个插件一行，写着它的中文名（作者给的）或包名、版本、作者自己的一句
 * 描述，自带的和第三方的分开标。带一个搜索框——插件多了以后靠翻是翻不完的。
 *
 * 数据来自宿主只读接口 GET /dsh-my-plugins/report（60 秒缓存，?force=1 强刷）。
 */

window.__ModuleLoader__.load({
  id: 'dsh-my-plugins',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useState } = React;

    const NS = 'dsh-my-plugins';

    const css = {
      chip: {
        position: 'fixed',
        top: 46,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2147483000,
        height: 24,
        padding: '0 10px',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.14)',
        background: 'rgba(28,28,34,0.92)',
        color: '#d9d9e3',
        fontSize: 12,
        lineHeight: '22px',
        cursor: 'pointer',
        userSelect: 'none',
        WebkitAppRegion: 'no-drag',
        boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
      },
      panel: {
        position: 'fixed',
        top: 76,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2147483001,
        width: 460,
        maxHeight: '68vh',
        overflow: 'auto',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(24,24,29,0.97)',
        color: '#e6e6ee',
        fontSize: 12,
        boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
        padding: '10px 12px',
      },
      head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 },
      input: {
        flex: '1 1 auto',
        minWidth: 0,
        height: 24,
        padding: '0 8px',
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.14)',
        background: 'rgba(255,255,255,0.04)',
        color: '#e6e6ee',
        fontSize: 12,
        outline: 'none',
      },
      row: { padding: '7px 0', borderTop: '1px solid rgba(255,255,255,0.06)' },
      line1: { display: 'flex', alignItems: 'baseline', gap: 6 },
      title: { fontWeight: 600, wordBreak: 'break-all' },
      ver: { color: '#6f6f7d', fontSize: 11, flex: '0 0 auto' },
      tag: {
        fontSize: 10,
        padding: '0 5px',
        borderRadius: 4,
        border: '1px solid rgba(255,255,255,0.14)',
        color: '#9a9aa8',
        flex: '0 0 auto',
      },
      tagMine: { borderColor: 'rgba(120,190,255,0.45)', color: '#8fc4ff' },
      enTag: {
        fontSize: 10,
        padding: '0 4px',
        marginRight: 4,
        borderRadius: 3,
        background: 'rgba(255,255,255,0.06)',
        color: '#7a7a88',
      },
      desc: { color: '#9aa0ac', fontSize: 11, marginTop: 3, lineHeight: 1.45, wordBreak: 'break-word' },
      btn: {
        height: 22,
        padding: '0 8px',
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.16)',
        background: 'transparent',
        color: '#cfcfda',
        fontSize: 11,
        cursor: 'pointer',
        flex: '0 0 auto',
      },
    };

    function hasCn(s) {
      return /[\u4e00-\u9fa5]/.test(String(s || ''));
    }

    function MyPlugins() {
      const [open, setOpen] = useState(false);
      const [data, setData] = useState(null);
      const [err, setErr] = useState('');
      const [busy, setBusy] = useState(false);
      const [q, setQ] = useState('');

      const load = useCallback(async (force) => {
        setBusy(true);
        try {
          const r = await fetch(`/${NS}/report` + (force ? '?force=1' : ''), { credentials: 'same-origin' });
          const j = await r.json();
          if (j && j.ok) {
            setData(j);
            setErr('');
          } else {
            setErr((j && j.error) || 'failed');
          }
        } catch {
          setErr('network');
        }
        setBusy(false);
      }, []);

      useEffect(() => {
        if (open && !data) load(false);
      }, [open, data, load]);

      const plugins = useMemo(() => {
        if (!data) return [];
        const all = data.plugins || [];
        const k = q.trim().toLowerCase();
        if (!k) return all;
        return all.filter(
          (p) =>
            String(p.id).toLowerCase().includes(k) ||
            String(p.title || '').toLowerCase().includes(k) ||
            String(p.desc || '').toLowerCase().includes(k),
        );
      }, [data, q]);

      const chipText = data ? `我装的插件 · ${data.total}` : '我装的插件';

      const chip = h(
        'div',
        { style: css.chip, onClick: () => setOpen((v) => !v), title: '点开看每个插件是干什么的' },
        chipText,
      );

      if (!open) return chip;

      const rows = plugins.map((p) =>
        h(
          'div',
          { key: p.id, style: css.row },
          h(
            'div',
            { style: css.line1 },
            h('span', { style: css.title }, p.title || p.id),
            p.version ? h('span', { style: css.ver }, 'v' + p.version) : null,
            h('span', { style: p.official ? css.tag : { ...css.tag, ...css.tagMine } }, p.official ? '自带' : '第三方'),
          ),
          p.title && p.title !== p.id ? h('div', { style: { ...css.desc, color: '#6f7480' } }, p.id) : null,
          p.desc
            ? h(
                'div',
                { style: css.desc },
                hasCn(p.desc) ? null : h('span', { style: css.enTag }, '英文原文'),
                p.desc,
              )
            : h('div', { style: { ...css.desc, color: '#5d5d6b' } }, '（这个插件没写描述）'),
        ),
      );

      const panel = h(
        'div',
        { style: css.panel },
        h(
          'div',
          { style: css.head },
          h('div', { style: { flex: '0 0 auto' } }, data ? `${data.total} 个 · 第三方 ${data.thirdParty}` : '读取中…'),
          h('input', {
            style: css.input,
            value: q,
            placeholder: '搜包名 / 名字 / 描述',
            onChange: (e) => setQ(e.target.value),
          }),
          h('button', { style: css.btn, onClick: () => load(true), disabled: busy }, busy ? '刷新中' : '重扫'),
          h('button', { style: css.btn, onClick: () => setOpen(false) }, '收起'),
        ),
        err ? h('div', { style: { color: '#e06a6a' } }, '出错：' + err) : null,
        data && data.profile
          ? h('div', { style: { color: '#6f7480', fontSize: 11, marginBottom: 4 } }, `配置：${data.profile.name}`)
          : null,
        rows.length ? rows : h('div', { style: { color: '#9a9aa8', padding: '8px 0' } }, data ? '没有匹配的插件' : '还没有数据，点「重扫」'),
      );

      return h(React.Fragment, null, chip, panel);
    }

    class Guard extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }
      static getDerivedStateFromError() {
        return { failed: true };
      }
      render() {
        return this.state.failed ? null : this.props.children;
      }
    }

    return {
      name: NS,
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: NS, order: 896 },
            function MyPluginsSlot() {
              return h(Guard, null, h(MyPlugins));
            },
          ),
        );
      },
    };
  },
});
