/*
 * 拖到页签上直接放入 —— 拖着物品停在左栏另一颗页签上，松手即把整叠放进那个容器（自动找位），界面停在当前页签不切换。
 *
 * 本模块只管三件事：拖动中页签的可放 / 不可放高亮、松手时判落在哪颗页签、放入成功后页签跳一下。
 * 真正放不放得进（容量 / 负重 / 只出不进 / 上锁）由页面把 itemId + 目标容器发给 Unity 判定，失败那边会飘字。
 *
 * 用法：
 *   var tabDrop = createTabDrop({
 *       getTabs: function () { return [{ el: 页签元素, key: 目标容器标识, blocked: 前端已知放不进(可选) }, ...]; },  // 只给非当前页签
 *       onDrop:  function (key, itemData, blocked) { core.UnitySendEvent(...); }
 *   });
 *   起拖时 tabDrop.arm();  松手时 var r = tabDrop.drop(x, y, itemData);  // null=没落在页签上 / 'ok' / 'blocked'
 *   拖拽结束（含取消）tabDrop.disarm();
 *
 * 热路径口径同 webui-drag-performance.md：mousemove 只记坐标 + 排帧；页签矩形在 arm 时缓存一次，拖动中不再读 DOM 尺寸；
 * 高亮按「换了一颗页签」增量改 class。动画只动 transform（webui-effects-performance.md）。
 */
(function (global) {
    'use strict';

    var STYLE_ID = 'tabdrop-style';
    var CSS = [
        '.tabdrop-armed{outline:1px dashed rgba(255,255,255,.38);outline-offset:1px;}',
        '.tabdrop-ok{outline:2px solid #8fdc7a!important;outline-offset:1px;color:#fff!important;background:rgba(120,200,110,.28)!important;}',
        '.tabdrop-no{outline:2px solid #e0705e!important;outline-offset:1px;color:#ffb4a8!important;background:rgba(200,70,55,.25)!important;}',
        '.tabdrop-got{animation:tabdrop-bump .35s ease-out;}',
        '@keyframes tabdrop-bump{0%{transform:scale(1);}40%{transform:scale(1.08);}100%{transform:scale(1);}}',
        'html.quality-low .tabdrop-got{animation:none;}'
    ].join('\n');

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    function clipRect(el, r) {
        // 页签条可横向滚动：被滚出可视区的那截不算命中
        var sc = el.closest ? el.closest('.bag-tabs-scroll, .left-tabs-scroll') : null;
        if (!sc) return r;
        var c = sc.getBoundingClientRect();
        var left = Math.max(r.left, c.left), right = Math.min(r.right, c.right);
        var top = Math.max(r.top, c.top), bottom = Math.min(r.bottom, c.bottom);
        if (right <= left || bottom <= top) return null;
        return { left: left, right: right, top: top, bottom: bottom };
    }

    function createTabDrop(opts) {
        ensureStyle();
        var tabs = null;
        var hover = null;
        var pos = null, raf = 0;

        function hit(x, y) {
            if (!tabs) return null;
            for (var i = 0; i < tabs.length; i++) {
                var r = tabs[i].rect;
                if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return tabs[i];
            }
            return null;
        }

        function setHover(t) {
            if (t === hover) return;
            if (hover) hover.el.classList.remove('tabdrop-ok', 'tabdrop-no');
            hover = t;
            if (hover) hover.el.classList.add(hover.blocked ? 'tabdrop-no' : 'tabdrop-ok');
        }

        function frame() {
            raf = 0;
            if (tabs && pos) setHover(hit(pos.x, pos.y));
        }

        function onMove(e) {
            pos = { x: e.clientX, y: e.clientY };
            if (!raf) raf = requestAnimationFrame(frame);
        }

        function arm() {
            disarm();
            var list = (opts.getTabs && opts.getTabs()) || [];
            tabs = [];
            for (var i = 0; i < list.length; i++) {
                var t = list[i];
                if (!t || !t.el) continue;
                tabs.push({ el: t.el, key: t.key, blocked: !!t.blocked, rect: clipRect(t.el, t.el.getBoundingClientRect()) });
                t.el.classList.add('tabdrop-armed');
            }
            if (!tabs.length) { tabs = null; return; }
            document.addEventListener('mousemove', onMove, true);
        }

        function disarm() {
            if (raf) { cancelAnimationFrame(raf); raf = 0; }
            document.removeEventListener('mousemove', onMove, true);
            setHover(null);
            if (tabs) for (var i = 0; i < tabs.length; i++) tabs[i].el.classList.remove('tabdrop-armed');
            tabs = null;
            pos = null;
        }

        function drop(x, y, itemData) {
            var t = hit(x, y);
            disarm();
            if (!t) return null;
            if (opts.onDrop) opts.onDrop(t.key, itemData, t.blocked);
            if (t.blocked) return 'blocked';
            var el = t.el;
            el.classList.remove('tabdrop-got');
            void el.offsetWidth;
            el.classList.add('tabdrop-got');
            setTimeout(function () { el.classList.remove('tabdrop-got'); }, 400);
            return 'ok';
        }

        return {
            arm: arm,
            disarm: disarm,
            drop: drop,
            isArmed: function () { return !!tabs; }
        };
    }

    global.createTabDrop = createTabDrop;
})(window);
