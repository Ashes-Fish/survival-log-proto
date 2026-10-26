/*
 * 分步引导浮层（聚光框 + 说明气泡）· 机器人面板 / 背包面板共用
 *
 * 形态：目标元素外面套一圈发光框，框外整屏压暗；旁边挂一枚气泡（标题 + 若干短行 + 跳过 / 下一步）。
 * 配色取机器人面板的冷青色 —— 这套引导只讲机器人相关的事，颜色本身就是「这是机器人的提示」的标识，
 * 与背包里后备箱、冰箱那类暖色引导气泡区分开。
 *
 * 为什么单独一个 js：BackpackUI.html 没有引用共享的 webui-core.js（它内联了自己的一份），
 * 写进 core 等于漏掉背包；拆成独立文件后两页各加一行 <script src> 即可（同 webui-tabhint.js 的做法）。
 *
 * 用法：
 *   var coach = WebUICoachmark.create();          // 默认冷青色（机器人 / 背包）
 *   var coach = WebUICoachmark.create({ theme: 'amber' });   // 琥珀色：手机页（与手机界面的强调色一致，2026-10-12 记录 app 引导）
 *   var coach = WebUICoachmark.create({ theme: 'amber', size: 'sm' });   // 小号气泡：挂在手机这类小面板旁边时用，字号 / 留白约缩到 0.8
 *   coach.start(steps, onFinish);   // onFinish(skipped) 在走完最后一步或点「跳过」时调一次
 *   coach.advance();                // 外部动作完成了当前「等操作」的一步（例如玩家真点了某个按钮）
 *   coach.stop();                   // 静默收起，不回调（面板要关了）
 *   coach.isActive(); coach.stepIndex();
 *
 * step 字段：
 *   target   : function() → Element | Element[] | null。多个元素取外接矩形；null = 不聚光，气泡居中压在 anchor 上
 *   anchor   : function() → Element（可选）：target 为 null 时气泡居中于它；缺省居中于视口
 *   beside   : function() → Element | Element[]（可选）：气泡要让开的范围（例如面板外侧挂着的模块栏）。
 *              先贴着聚光框摆，压到它就挪到它下方，下方放不下才整个摆到它外侧
 *   onEnter  : function()（可选）：进入这一步时先执行（例如先收起挡住目标的弹层），之后下一帧再量位置
 *   emphasis : true = 聚光框用醒目款（加粗 + 快呼吸 + 外圈扩散）；不填时「等操作」的一步自动用醒目款
 *   行格式   : 以冒号收尾的行视为引导语、不画圆点；以 ①②… 开头的行自带序号、不画圆点
 *   title    : string
 *   lines    : string[]。行内 *…* 包住的是高亮词
 *   btn      : 按钮文字；不给且给了 hint = 这一步要玩家做完某个操作（由页面调 advance() 推进），不出按钮
 *   hint     : 等操作时底部的提示文字
 *   skip     : 「跳过」文字（空 = 不出跳过）
 *   blockClicks : true = 引导期间吞掉页面其余点击（默认 true）；等操作的那一步应传 false，让玩家能点到目标
 *
 * 不用 backdrop-filter；动画只动 opacity / transform，唯一的 infinite 动画在 quality-low 下静态化；
 * 换步时聚光框直接跳到新位置，不给 left / top / width / height 挂过渡。
 * 位置用 fixed + getBoundingClientRect，每次进步、窗口变化时重算，不参与各面板自己的布局流。
 */
(function () {
    'use strict';

    var STYLE_ID = 'coachmark-style';
    var CSS = [
        '.cm-layer { position: fixed; inset: 0; z-index: 2147482000; pointer-events: none; }',
        '.cm-catch { position: fixed; inset: 0; pointer-events: auto; background: transparent; }',
        '.cm-spot { position: fixed; border-radius: 8px; pointer-events: none;',
        '    box-shadow: 0 0 0 4000px rgba(2, 8, 12, 0.62); border: 1.5px solid rgba(92, 216, 238, 0.9); }',
        '.cm-spot::after { content: ""; position: absolute; inset: -2px; border-radius: inherit;',
        '    box-shadow: 0 0 14px rgba(92, 216, 238, 0.75), inset 0 0 10px rgba(92, 216, 238, 0.22);',
        '    animation: cm-pulse 1.6s ease-in-out infinite; }',
        '.cm-spot.none { width: 0 !important; height: 0 !important; border: none; }',
        '.cm-spot.none::after { display: none; }',
        '@keyframes cm-pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }',
        '.cm-tip { position: fixed; min-width: 280px; max-width: 360px; pointer-events: auto;',
        '    background: linear-gradient(168deg, rgb(21, 36, 46) 0%, rgb(11, 18, 25) 100%);',
        '    border: 1px solid rgba(92, 216, 238, 0.55); border-radius: 10px; padding: 16px 20px 14px;',
        '    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(160, 220, 240, 0.10);',
        '    font-family: "Segoe UI", "Microsoft YaHei", sans-serif; text-align: left; user-select: none;',
        '    animation: cm-in .3s cubic-bezier(.19,1,.22,1); }',
        '@keyframes cm-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }',
        '.cm-tip .cm-t { font-size: 15px; font-weight: 700; color: #5cd8ee; letter-spacing: .5px; margin-bottom: 10px;',
        '    text-shadow: 0 0 10px rgba(92, 216, 238, 0.35); }',
        '.cm-tip .cm-l { position: relative; font-size: 13.5px; line-height: 1.6; color: #e6f1f6; margin: 0 0 6px; padding-left: 14px; }',
        /* 条目前的小圆点；引导语（以冒号收尾）与自带序号（①②…）的行不画点 */
        '.cm-tip .cm-l::before { content: ""; position: absolute; left: 2px; top: .72em; width: 5px; height: 5px; border-radius: 50%;',
        '    background: #5cd8ee; box-shadow: 0 0 4px rgba(92, 216, 238, 0.6); }',
        '.cm-tip .cm-l.nb::before { display: none; }',
        '.cm-tip .cm-l.lead { padding-left: 0; }',
        '.cm-tip .cm-l:last-child { margin-bottom: 0; }',
        '.cm-tip .cm-l em { font-style: normal; color: #86e6f1; }',
        '.cm-tip .cm-f { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; gap: 14px; }',
        '.cm-tip .cm-pg { font-size: 11px; color: #5d7079; }',
        '.cm-tip .cm-r { display: flex; align-items: center; gap: 12px; }',
        '.cm-tip .cm-skip { font-size: 12px; color: #6f8791; cursor: pointer; background: none; border: none; padding: 0; font-family: inherit; }',
        '.cm-tip .cm-skip:hover { color: #a9c3cc; }',
        '.cm-tip .cm-btn { font-size: 13px; font-weight: 600; color: #0b1219; background: #5cd8ee; border: none; border-radius: 6px;',
        '    padding: 5px 18px; cursor: pointer; font-family: inherit; }',
        '.cm-tip .cm-btn:hover { filter: brightness(1.12); }',
        '.cm-tip .cm-hint { font-size: 12px; color: #86e6f1; }',
        '.cm-tip::before { content: ""; position: absolute; border: 7px solid transparent; }',
        '.cm-tip.ar-l::before { left: -14px; top: var(--ay, 18px); border-right-color: rgba(92, 216, 238, 0.55); }',
        '.cm-tip.ar-r::before { right: -14px; top: var(--ay, 18px); border-left-color: rgba(92, 216, 238, 0.55); }',
        '.cm-tip.ar-t::before { top: -14px; left: var(--ax, 24px); border-bottom-color: rgba(92, 216, 238, 0.55); }',
        '.cm-tip.ar-b::before { bottom: -14px; left: var(--ax, 24px); border-top-color: rgba(92, 216, 238, 0.55); }',
        /* 等玩家操作的那一步：边框加粗、呼吸加快，外面再套一圈向外扩散的环（只动 transform / opacity） */
        '.cm-spot.strong { border-width: 2px; border-color: #7fe6f6; }',
        '.cm-spot.strong::after { box-shadow: 0 0 20px rgba(92, 216, 238, 0.95), inset 0 0 14px rgba(92, 216, 238, 0.35);',
        '    animation-duration: 1s; }',
        '.cm-spot.strong::before { content: ""; position: absolute; inset: -3px; border-radius: inherit;',
        '    border: 2px solid rgba(127, 230, 246, 0.9); animation: cm-ring 1.4s ease-out infinite; }',
        '@keyframes cm-ring { 0% { opacity: .9; transform: scale(1); } 100% { opacity: 0; transform: scale(1.35, 1.6); } }',
        'html.quality-low .cm-spot::after { animation: none; opacity: .75; }',
        'html.quality-low .cm-spot.strong::before { animation: none; opacity: .6; }',
        'html.quality-low .cm-tip { animation: none; }',
        /* 琥珀色主题：只换颜色，形态与冷青色完全一致 */
        '.cm-layer.cm-amber .cm-spot { border-color: rgba(255, 193, 7, 0.9); }',
        '.cm-layer.cm-amber .cm-spot::after { box-shadow: 0 0 14px rgba(255, 193, 7, 0.75), inset 0 0 10px rgba(255, 193, 7, 0.22); }',
        '.cm-layer.cm-amber .cm-spot.strong { border-color: #ffd54f; }',
        '.cm-layer.cm-amber .cm-spot.strong::after { box-shadow: 0 0 20px rgba(255, 193, 7, 0.95), inset 0 0 14px rgba(255, 193, 7, 0.35); }',
        '.cm-layer.cm-amber .cm-spot.strong::before { border-color: rgba(255, 213, 79, 0.9); }',
        '.cm-layer.cm-amber .cm-tip { background: linear-gradient(168deg, rgb(51, 41, 29) 0%, rgb(27, 21, 14) 100%); border-color: rgba(255, 193, 7, 0.55);',
        '    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 220, 150, 0.10); }',
        '.cm-layer.cm-amber .cm-tip .cm-t { color: #ffc107; text-shadow: 0 0 10px rgba(255, 193, 7, 0.3); }',
        '.cm-layer.cm-amber .cm-tip .cm-l { color: #f1e9dc; }',
        '.cm-layer.cm-amber .cm-tip .cm-l::before { background: #ffc107; box-shadow: 0 0 4px rgba(255, 193, 7, 0.6); }',
        '.cm-layer.cm-amber .cm-tip .cm-l em { color: #ffc107; }',
        '.cm-layer.cm-amber .cm-tip .cm-pg { color: #8a7a62; }',
        '.cm-layer.cm-amber .cm-tip .cm-skip { color: #9a8a72; }',
        '.cm-layer.cm-amber .cm-tip .cm-skip:hover { color: #d8c8a8; }',
        '.cm-layer.cm-amber .cm-tip .cm-btn { color: #1a1408; background: #ffc107; }',
        '.cm-layer.cm-amber .cm-tip .cm-hint { color: #ffc107; }',
        '.cm-layer.cm-amber .cm-tip.ar-l::before { border-right-color: rgba(255, 193, 7, 0.55); }',
        '.cm-layer.cm-amber .cm-tip.ar-r::before { border-left-color: rgba(255, 193, 7, 0.55); }',
        '.cm-layer.cm-amber .cm-tip.ar-t::before { border-bottom-color: rgba(255, 193, 7, 0.55); }',
        '.cm-layer.cm-amber .cm-tip.ar-b::before { border-top-color: rgba(255, 193, 7, 0.55); }',
        /* 小号：只缩字号与留白，配色、箭头位置与默认一致 */
        '.cm-layer.cm-sm .cm-tip { min-width: 200px; max-width: 264px; padding: 11px 14px 10px; border-radius: 8px; }',
        '.cm-layer.cm-sm .cm-tip .cm-t { font-size: 12.5px; margin-bottom: 6px; }',
        '.cm-layer.cm-sm .cm-tip .cm-l { font-size: 11px; line-height: 1.5; margin-bottom: 3px; padding-left: 11px; }',
        '.cm-layer.cm-sm .cm-tip .cm-l::before { left: 1px; width: 4px; height: 4px; }',
        '.cm-layer.cm-sm .cm-tip .cm-l.lead { padding-left: 0; }',
        '.cm-layer.cm-sm .cm-tip .cm-f { margin-top: 9px; gap: 10px; }',
        '.cm-layer.cm-sm .cm-tip .cm-pg { font-size: 10px; }',
        '.cm-layer.cm-sm .cm-tip .cm-btn { font-size: 11px; padding: 3px 13px; border-radius: 5px; }',
        '.cm-layer.cm-sm .cm-tip .cm-hint { font-size: 10.5px; }'
    ].join('\n');

    var GAP = 14;       // 气泡与聚光框的间距
    var PAD = 6;        // 聚光框比目标外扩
    var EDGE = 8;       // 离视口边缘至少留这么多

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) { return; }
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /* 先转义再把 *…* 换成强调色：文案来自词条表，不信任其中的任何标签 */
    function markup(s) {
        return esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>');
    }

    function unionRect(els) {
        var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity, any = false;
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (!el || !el.getBoundingClientRect) { continue; }
            var rc = el.getBoundingClientRect();
            if (rc.width <= 0 && rc.height <= 0) { continue; }
            any = true;
            l = Math.min(l, rc.left); t = Math.min(t, rc.top);
            r = Math.max(r, rc.right); b = Math.max(b, rc.bottom);
        }
        return any ? { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t } : null;
    }

    function resolveTarget(fn) {
        if (typeof fn !== 'function') { return null; }
        var v = fn();
        if (!v) { return null; }
        return unionRect(Array.isArray(v) ? v : [v]);
    }

    function create(opts) {
        var theme = (opts && opts.theme) || '';
        var size = (opts && opts.size) || '';
        var layer = null, spot = null, tip = null, catcher = null;
        var steps = [], idx = -1, finishCb = null;

        function build() {
            ensureStyle();
            layer = document.createElement('div');
            layer.className = 'cm-layer' + (theme ? ' cm-' + theme : '') + (size ? ' cm-' + size : '');
            catcher = document.createElement('div');
            catcher.className = 'cm-catch unity-interactive';
            catcher.addEventListener('mousedown', function (e) { e.stopPropagation(); e.preventDefault(); });
            catcher.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); });
            spot = document.createElement('div');
            spot.className = 'cm-spot none';
            tip = document.createElement('div');
            tip.className = 'cm-tip unity-interactive';
            tip.addEventListener('mousedown', function (e) { e.stopPropagation(); });
            tip.addEventListener('click', function (e) { e.stopPropagation(); });
            layer.appendChild(catcher);
            layer.appendChild(spot);
            layer.appendChild(tip);
            document.body.appendChild(layer);
            window.addEventListener('resize', place);
        }

        function teardown() {
            window.removeEventListener('resize', place);
            if (layer && layer.parentNode) { layer.parentNode.removeChild(layer); }
            layer = spot = tip = catcher = null;
            steps = []; idx = -1;
        }

        function render() {
            var st = steps[idx];
            var total = steps.length;
            var html = '<div class="cm-t">' + esc(st.title) + '</div>';
            (st.lines || []).forEach(function (ln) {
                if (!ln) { return; }
                var cls = 'cm-l';
                if (/[：:]\s*$/.test(ln)) { cls += ' nb lead'; }
                else if (/^\s*[\u2460-\u2473]/.test(ln)) { cls += ' nb'; }
                html += '<p class="' + cls + '">' + markup(ln) + '</p>';
            });
            var right = '';
            if (st.btn) {
                if (st.skip) { right += '<button class="cm-skip" type="button" data-act="skip">' + esc(st.skip) + '</button>'; }
                right += '<button class="cm-btn" type="button" data-act="next">' + esc(st.btn) + '</button>';
            } else {
                if (st.skip) { right += '<button class="cm-skip" type="button" data-act="skip">' + esc(st.skip) + '</button>'; }
                right += '<span class="cm-hint">' + esc(st.hint || '') + '</span>';
            }
            html += '<div class="cm-f"><span class="cm-pg">' + (total > 1 ? (idx + 1) + ' / ' + total : '') + '</span>' +
                '<span class="cm-r">' + right + '</span></div>';
            tip.innerHTML = html;
            var btns = tip.querySelectorAll('[data-act]');
            for (var i = 0; i < btns.length; i++) {
                btns[i].addEventListener('click', onAct);
            }
            catcher.style.pointerEvents = st.blockClicks === false ? 'none' : 'auto';
            var strong = st.emphasis === true || (st.emphasis !== false && !st.btn);
            spot.classList.toggle('strong', strong);
            if (typeof st.onEnter === 'function') {
                st.onEnter();
                /* onEnter 往往改了页面（收弹层），等页面重排完再量；先按当前布局摆一次，免得空一帧 */
                place();
                window.requestAnimationFrame(function () { window.requestAnimationFrame(place); });
                return;
            }
            place();
        }

        function onAct(e) {
            var act = e.currentTarget.getAttribute('data-act');
            if (act === 'skip') { finish(true); }
            else { next(); }
        }

        /* 气泡优先放目标右侧，放不下换左侧，再不行放下方 / 上方；箭头对准聚光框 */
        function place() {
            if (!layer || idx < 0) { return; }
            var st = steps[idx];
            var vw = window.innerWidth, vh = window.innerHeight;
            var rc = resolveTarget(st.target);
            tip.classList.remove('ar-l', 'ar-r', 'ar-t', 'ar-b');
            tip.style.removeProperty('--ay');
            tip.style.removeProperty('--ax');
            var tw = tip.offsetWidth, th = tip.offsetHeight;

            if (!rc) {
                spot.classList.add('none');
                var an = resolveTarget(st.anchor) || { left: 0, top: 0, width: vw, height: vh };
                spot.style.left = (an.left + an.width / 2) + 'px';
                spot.style.top = (an.top + an.height / 2) + 'px';
                tip.style.left = Math.round(clamp(an.left + (an.width - tw) / 2, EDGE, vw - tw - EDGE)) + 'px';
                tip.style.top = Math.round(clamp(an.top + (an.height - th) / 2, EDGE, vh - th - EDGE)) + 'px';
                return;
            }

            spot.classList.remove('none');
            var sl = rc.left - PAD, stp = rc.top - PAD, sw = rc.width + PAD * 2, sh = rc.height + PAD * 2;
            spot.style.left = sl + 'px'; spot.style.top = stp + 'px';
            spot.style.width = sw + 'px'; spot.style.height = sh + 'px';

            var x, y, side;
            var bz = resolveTarget(st.beside);
            var hits = function (bx, by) {
                return !!bz && bx < bz.right && bx + tw > bz.left && by < bz.bottom && by + th > bz.top;
            };
            if (sl + sw + GAP + tw <= vw - EDGE) {
                /* 右侧贴着聚光框 */
                side = 'l'; x = sl + sw + GAP;
                y = clamp(stp, EDGE, vh - th - EDGE);
                if (hits(x, y)) {
                    var below = bz.bottom + GAP;
                    if (below + th <= vh - EDGE && below < stp + sh - 24) { y = below; }
                    else { x = Math.max(x, bz.right + GAP); if (x + tw > vw - EDGE) { side = null; } }
                }
            }
            if (!side && sl - GAP - tw >= EDGE) {
                side = 'r'; x = sl - GAP - tw;
                y = clamp(stp, EDGE, vh - th - EDGE);
                if (hits(x, y)) { x = bz.left - GAP - tw; if (x < EDGE) { side = null; } }
            }
            if (side) {
                /* 箭头对准聚光框上沿附近；气泡下移过就对准气泡自己的上沿 */
                var ay = clamp(Math.max(stp, y) + 18 - y - 7, 10, th - 24);
                tip.style.setProperty('--ay', ay + 'px');
            } else {
                x = clamp(sl + sw / 2 - tw / 2, EDGE, vw - tw - EDGE);
                if (stp + sh + GAP + th <= vh - EDGE) { side = 't'; y = stp + sh + GAP; }
                else { side = 'b'; y = Math.max(EDGE, stp - GAP - th); }
                tip.style.setProperty('--ax', clamp(sl + sw / 2 - x - 7, 12, tw - 26) + 'px');
            }
            tip.classList.add('ar-' + side);
            tip.style.left = Math.round(x) + 'px';
            tip.style.top = Math.round(y) + 'px';
        }

        function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

        function next() {
            if (idx < 0) { return; }
            if (idx >= steps.length - 1) { finish(false); return; }
            idx++;
            render();
        }

        function finish(skipped) {
            var cb = finishCb;
            finishCb = null;
            teardown();
            if (cb) { cb(!!skipped); }
        }

        return {
            start: function (list, onFinish) {
                if (!list || !list.length) { return; }
                if (layer) { teardown(); }
                steps = list; idx = 0; finishCb = onFinish || null;
                build();
                render();
            },
            advance: function () { next(); },
            stop: function () { finishCb = null; teardown(); },
            refresh: function () { place(); },
            isActive: function () { return !!layer; },
            stepIndex: function () { return idx; }
        };
    }

    window.WebUICoachmark = { create: create };
})();
