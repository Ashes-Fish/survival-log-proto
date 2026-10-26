(function (global) {
    'use strict';

    // 「脚边」横排：物品界面下方那一排身边地面物品。原生 DOM 实现，Vue 页与原生页都能挂。
    //
    // 数据：C# 下发的 JSON（{label, allText, groups:[{cfg,name,icon,w,h,count,heavy,ids}]}），同种东西已合成一组。
    // 交互：点一格 / 右键一格 = GROUND_PICK {ids, all:false}（只捡一箱还是整组由 C# 按 Shift 决定）；
    //       点「全拿」= GROUND_PICK {ids:全部, all:true}；
    //       按住一格拖出去 = 交给页面 onDragStart（页面用自己的格子背包拖拽判落点，再发 GROUND_PICK_TO）。
    // 位置：挂在页面给的锚点（通常是玩家背包那块面板）下方，横排左沿对齐锚点；
    //       会压到左下角 HUD（背包 / 制造按钮、听听音乐、行为队列 + 倍速条）时右移到行为队列右边再找；
    //       标准高度放不下换紧凑档；都放不下贴屏幕底。
    // 图标大小按物品在背包里占几格分三档，不成正比（1 格 / 2 格 / 3 格及以上），底边对齐。

    var STYLE_ID = 'gd-style';
    var CSS = [
        '.gd-row{position:fixed;z-index:60;display:none;flex-direction:row;align-items:flex-end;gap:5px;',
        'padding:8px 40px 8px 14px;box-sizing:border-box;pointer-events:auto;user-select:none;}',
        '.gd-row::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;',
        'background:linear-gradient(90deg,rgba(8,8,10,0) 0,rgba(8,8,10,.72) 14px,rgba(8,8,10,.62) calc(100% - 60px),rgba(8,8,10,0) 100%);}',
        '.gd-label{align-self:flex-end;display:flex;flex-direction:column;gap:3px;width:50px;flex-shrink:0;',
        'font-size:12px;color:#cfd3dc;text-shadow:0 1px 2px #000;line-height:1.25;}',
        '.gd-label b{color:#fff;font-weight:600;}',
        '.gd-all{display:inline-flex;align-items:center;gap:1px;font-size:11px;color:#ffd970;cursor:pointer;}',
        '.gd-all:hover{color:#fff;}',
        '.gd-all svg{width:11px;height:11px;fill:currentColor;}',
        '.gd-ico{position:relative;flex-shrink:0;box-sizing:border-box;border-radius:6px;cursor:pointer;',
        'background:linear-gradient(180deg,rgba(64,64,68,.92) 0%,rgba(40,40,44,.95) 100%);',
        'border:1px solid rgba(200,200,200,.35);display:flex;align-items:center;justify-content:center;',
        'transition:border-color .12s;}',
        '.gd-ico:hover{border-color:rgba(255,255,255,.85);}',
        '.gd-ico img{width:84%;height:84%;object-fit:contain;pointer-events:none;}',
        '.gd-ico.heavy img{opacity:.4;}',
        '.gd-ico.gd-dragging{opacity:.35;}',
        '.gd-cnt{position:absolute;right:2px;bottom:1px;font-size:9.5px;font-weight:700;color:#fff;',
        'text-shadow:0 1px 2px #000,0 0 3px #000;pointer-events:none;}',
        '.gd-more{height:28px;padding:0 8px;border-radius:6px;background:rgba(255,255,255,.08);color:#dde2f0;',
        'font-size:12.5px;font-weight:600;display:flex;align-items:center;cursor:pointer;flex-shrink:0;}',
        '.gd-more:hover{background:rgba(255,255,255,.16);}',
        '.gd-tip{position:fixed;z-index:61;display:none;white-space:nowrap;pointer-events:none;font-size:12px;color:#eee;',
        'background:rgba(12,12,14,.95);border:1px solid rgba(255,255,255,.15);border-radius:5px;padding:3px 8px;}',
    ].join('');

    var UP_SVG = '<svg viewBox="0 0 24 24"><path d="M12 4l-7 7h4v8h6v-8h4z"/></svg>';

    // 左下角 HUD 占用区（CSS 视口像素，1536×864 基准；HUD 靠左下贴边，宽屏下横坐标不变）
    var HUD_ZONES = [
        { x: 0, y: 684, w: 128, h: 180 },
        { x: 84, y: 758, w: 112, h: 40 },
        { x: 88, y: 798, w: 502, h: 66 }
    ];
    var HUD_RIGHT_X = 596;

    var TIERS = [
        { name: 'normal', s1: 36, s2: 48, s3: 56, h: 72 },
        { name: 'compact', s1: 30, s2: 38, s3: 44, h: 58 }
    ];
    var ROW_MAX_W = 470;
    var GAP = 10, MARGIN = 6;
    var DRAG_THRESHOLD = 5;

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    function side(t, n) { return n <= 1 ? t.s1 : (n === 2 ? t.s2 : t.s3); }

    function intersects(a, b) {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    /**
     * @param opts {
     *   send(eventName, payload)          —— 发给 C#（页面的 core.UnitySendEvent）
     *   getAnchorRect() → DOMRect|null    —— 横排挂在它下面（视口像素）
     *   getObstacleRects() → DOMRect[]    —— 页面自己的面板，横排不能压
     *   getZoom() → number                —— body zoom（没有就 1）
     *   onDragStart(e, group) → bool      —— 按住一格拖出去时调用，页面接管拖拽；返回 false 表示本页不支持
     *   onLayout()                        —— 位置 / 显隐变了（页面据此同步可点击区域）
     * }
     */
    function createGroundDock(opts) {
        ensureStyle();
        opts = opts || {};
        var root = document.createElement('div');
        root.className = 'gd-row unity-interactive';
        root.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        document.body.appendChild(root);
        var tip = document.createElement('div');
        tip.className = 'gd-tip';
        tip.setAttribute('data-no-sync', '');
        document.body.appendChild(tip);

        var data = null;
        var expanded = false;
        var tier = TIERS[0];
        var press = null;

        function zoom() { return (opts.getZoom && opts.getZoom()) || 1; }

        function allIds() {
            var ids = [];
            if (!data) return ids;
            data.groups.forEach(function (g) { for (var i = 0; i < g.ids.length; i++) ids.push(g.ids[i]); });
            return ids;
        }

        function render() {
            root.innerHTML = '';
            if (!data || !data.groups.length) return;
            var total = 0;
            data.groups.forEach(function (g) { total += g.count; });

            var label = document.createElement('div');
            label.className = 'gd-label';
            var name = document.createElement('span');
            name.innerHTML = '';
            name.appendChild(document.createTextNode((data.label || '') + ' '));
            var num = document.createElement('b');
            num.textContent = String(total);
            name.appendChild(num);
            label.appendChild(name);
            if (data.groups.length >= 2 || total >= 2) {
                var all = document.createElement('span');
                all.className = 'gd-all';
                all.innerHTML = UP_SVG;
                all.appendChild(document.createTextNode(data.allText || ''));
                all.addEventListener('click', function (e) {
                    e.stopPropagation();
                    opts.send && opts.send('GROUND_PICK', { ids: allIds(), all: true });
                });
                label.appendChild(all);
            }
            root.appendChild(label);

            var used = 60, hidden = 0;
            for (var i = 0; i < data.groups.length; i++) {
                var g = data.groups[i];
                var pw = side(tier, g.w), ph = side(tier, g.h);
                if (!expanded && used + pw + 5 > ROW_MAX_W - (i < data.groups.length - 1 ? 44 : 0)) {
                    hidden = data.groups.length - i;
                    break;
                }
                used += pw + 5;
                root.appendChild(makeIcon(g, pw, ph));
            }
            if (hidden > 0) {
                var more = document.createElement('div');
                more.className = 'gd-more';
                more.textContent = '+' + hidden;
                more.addEventListener('click', function (e) {
                    e.stopPropagation();
                    expanded = true;
                    render();
                    place();
                });
                root.appendChild(more);
            }
        }

        function makeIcon(g, pw, ph) {
            var el = document.createElement('div');
            el.className = 'gd-ico' + (g.heavy ? ' heavy' : '');
            el.style.width = pw + 'px';
            el.style.height = ph + 'px';
            if (g.icon) {
                var img = document.createElement('img');
                img.src = g.icon;
                img.draggable = false;
                el.appendChild(img);
            }
            if (g.count > 1) {
                var c = document.createElement('span');
                c.className = 'gd-cnt';
                c.textContent = 'x' + g.count;
                el.appendChild(c);
            }
            el.addEventListener('mouseenter', function () { showTip(el, g.name); });
            el.addEventListener('mouseleave', hideTip);
            el.addEventListener('mousedown', function (e) {
                // 右键：与点击同义，直接捡进背包（与格子背包里「右键快速转移」的手感一致）
                if (e.button === 2) {
                    e.preventDefault();
                    e.stopPropagation();
                    hideTip();
                    opts.send && opts.send('GROUND_PICK', { ids: g.ids.slice(), all: false });
                    return;
                }
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                press = { g: g, el: el, x: e.clientX, y: e.clientY };
                window.addEventListener('mousemove', onPressMove);
                window.addEventListener('mouseup', onPressUp);
            });
            return el;
        }

        function endPress() {
            window.removeEventListener('mousemove', onPressMove);
            window.removeEventListener('mouseup', onPressUp);
            press = null;
        }

        function onPressMove(e) {
            if (!press) return;
            var z = zoom();
            if (Math.abs(e.clientX - press.x) / z <= DRAG_THRESHOLD && Math.abs(e.clientY - press.y) / z <= DRAG_THRESHOLD) return;
            var p = press;
            endPress();
            hideTip();
            if (opts.onDragStart && opts.onDragStart(e, p.g) === true) {
                p.el.classList.add('gd-dragging');
            }
        }

        function onPressUp(e) {
            if (!press) return;
            var g = press.g;
            endPress();
            if (e.button !== undefined && e.button !== 0) return;
            opts.send && opts.send('GROUND_PICK', { ids: g.ids.slice(), all: false });
        }

        function showTip(el, text) {
            if (!text) return;
            tip.textContent = text;
            tip.style.display = 'block';
            var z = zoom();
            var r = el.getBoundingClientRect();
            var tw = tip.offsetWidth * z, th = tip.offsetHeight * z;
            var x = r.left + r.width / 2 - tw / 2;
            var y = r.top - th - 8;
            tip.style.left = Math.max(4, x) / z + 'px';
            tip.style.top = Math.max(4, y) / z + 'px';
        }

        function hideTip() { tip.style.display = 'none'; }

        // 在 [x, x+w] 这段横坐标里，从 yMin 往下找第一段高度够 h 的空白（页面面板 + HUD 都算占用）
        function findBand(x, w, h, yMin, obstacles) {
            var vh = window.innerHeight;
            var blocks = [];
            obstacles.forEach(function (r) { if (r.x < x + w && r.x + r.w > x) blocks.push(r); });
            HUD_ZONES.forEach(function (r) { if (r.x < x + w && r.x + r.w > x) blocks.push(r); });
            var y = yMin;
            for (var guard = 0; guard < 50; guard++) {
                var cand = { x: x, y: y + GAP, w: w, h: h };
                if (cand.y + h > vh - MARGIN) return null;
                var hit = null;
                for (var i = 0; i < blocks.length; i++) {
                    if (intersects(cand, blocks[i]) && (!hit || blocks[i].y + blocks[i].h > hit.y + hit.h)) hit = blocks[i];
                }
                if (!hit) return cand.y;
                y = hit.y + hit.h;
            }
            return null;
        }

        function toBox(r) { return { x: r.left, y: r.top, w: r.width, h: r.height }; }

        function place() {
            var visible = !!(data && data.groups.length);
            root.style.display = visible ? 'flex' : 'none';
            if (!visible) { hideTip(); if (opts.onLayout) opts.onLayout(); return; }

            var z = zoom();
            var anchor = opts.getAnchorRect ? opts.getAnchorRect() : null;
            var obstacles = (opts.getObstacleRects ? opts.getObstacleRects() : []).filter(Boolean).map(toBox);
            var ax = anchor ? anchor.left : HUD_RIGHT_X;
            var ay = anchor ? anchor.bottom : window.innerHeight * 0.5;
            var xs = [Math.max(8, ax)];
            if (xs[0] < HUD_RIGHT_X) xs.push(HUD_RIGHT_X);

            var chosen = null;
            for (var t = 0; t < TIERS.length && !chosen; t++) {
                if (tier !== TIERS[t]) { tier = TIERS[t]; render(); }
                var w = root.offsetWidth * z, h = tier.h * z;
                for (var k = 0; k < xs.length && !chosen; k++) {
                    var y = findBand(xs[k], w, h, ay, obstacles);
                    if (y !== null) chosen = { x: xs[k], y: y };
                }
            }
            if (!chosen) {
                // 界面下方没有空地：紧凑档贴屏幕底，横坐标仍避开 HUD
                chosen = { x: Math.max(ax, HUD_RIGHT_X), y: window.innerHeight - MARGIN - tier.h * z };
            }
            root.style.height = tier.h + 'px';
            root.style.left = chosen.x / z + 'px';
            root.style.top = chosen.y / z + 'px';
            if (opts.onLayout) opts.onLayout();
        }

        function setData(json) {
            var next = null;
            try { next = json ? JSON.parse(json) : null; } catch (e) { next = null; }
            if (next && !Array.isArray(next.groups)) next = null;
            data = next;
            if (!data || !data.groups.length) expanded = false;
            tier = TIERS[0];
            render();
            place();
        }

        function isOver(x, y) {
            if (root.style.display === 'none') return false;
            var r = root.getBoundingClientRect();
            return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        }

        function clearDragging() {
            var list = root.querySelectorAll('.gd-dragging');
            for (var i = 0; i < list.length; i++) list[i].classList.remove('gd-dragging');
        }

        window.addEventListener('resize', place);

        return {
            setData: setData,
            place: place,
            isOver: isOver,
            clearDragging: clearDragging,
            destroy: function () {
                window.removeEventListener('resize', place);
                endPress();
                root.remove();
                tip.remove();
            }
        };
    }

    global.createGroundDock = createGroundDock;
})(window);
