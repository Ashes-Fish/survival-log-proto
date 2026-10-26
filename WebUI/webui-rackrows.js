/*
 * 材料架分行视图（材料架面板右栏 + 制造台 / 粉碎机 / 交易 / 无人机中控台左栏的材料架页签共用）。
 *
 * 一个显示行 = 材料架背包里的一个格子行（2×2 这类高两格的材料占相邻两个格子行，算一个显示行，高度也是两行）。
 * 一行只放一种材料；同种材料的几行挨在一起，左边共用一块名牌（名称 + 这种材料的总件数，跨过这几行）。
 * 每件一张卡片，按材料真实宽高比例绘制，自左向右叠放，左边一张压住右边一张；
 * 间距按「这一行最多放几件」铺满轨道，所以一行的长度就是这一行的存量。满行时凹槽描一圈淡金内边。
 * 没用到的行排在最底下，不画名牌，只画一条定位标线。
 *
 * 行数据（每项；数组顺序即显示顺序，由 C# 行构造器排好：同种材料的行相邻、空行在最后）：
 *   configId, name, icon, w, h
 *   count   —— 这一行的件数
 *   cap     —— 这一行最多放几件（行长 ÷ 材料宽）
 *   rowY    —— 这一行在材料架格子里的行号（2×2 取上沿那一行），行的身份
 *   lastId  —— 这一行最后一件的实例 id（点这一行取 1 件，取的就是它）
 *   ok      —— 这一行能不能放到当前面板的目标区（false 时点卡片走 onBlocked）
 *   fit / fitReason —— 可选，只有带取出按钮的面板用
 *   configId 为 0 的项 = 空行
 *
 * 性能约束：卡片位置与转角只写 transform，过渡只动 transform；悬停 / 满行 / 拖拽提示只切 class，不做过渡。
 * 行结构（行身份 + 材料 + 空行数）不变时原地更新，卡片节点复用，不整片重建。
 */
(function (global) {
    'use strict';

    var STYLE_ID = 'rk-rows-style';
    var CSS = [
        '.rk-host{--rk-accent:#FFC107;--rk-gap:4px;',
        '  --rk-card-bg:linear-gradient(rgba(170,170,170,.1),rgba(170,170,170,.1)),linear-gradient(180deg,#16161a 0%,#20201f 100%);',
        '  --rk-card-border:rgba(200,200,200,.5);}',
        '.rk-grp{display:flex;align-items:stretch;gap:10px;}',
        '.rk-grp + .rk-grp{margin-top:var(--rk-gap);}',
        '.rk-rows{display:flex;flex-direction:column;}',
        '.rk-row{display:flex;align-items:center;gap:10px;}',
        '.rk-row + .rk-row{margin-top:var(--rk-gap);}',
        /* 名牌：半透明羽化暖色衬底，静态渐变 */
        '.rk-plate{flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;text-align:center;overflow:hidden;',
        '  background:radial-gradient(closest-side,rgba(214,158,72,.30) 0%,rgba(214,158,72,.16) 45%,rgba(214,158,72,.05) 78%,rgba(214,158,72,0) 100%);}',
        '.rk-plate.rk-blank{visibility:hidden;}',
        '.rk-plate-name{max-width:100%;font-size:13px;color:#eadfc4;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
        '.rk-plate-count{font-size:18px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums;line-height:1.1;text-shadow:0 1px 2px rgba(0,0,0,.6);}',
        '.rk-compact .rk-plate-name{font-size:11.5px;letter-spacing:.5px;}',
        '.rk-compact .rk-plate-count{font-size:14px;}',
        /* 轨道：有材料的行是淡凹槽（高度贴着卡片），空行只留一条定位标线 */
        '.rk-track{position:relative;flex:none;border-radius:6px;}',
        '.rk-row.rk-can .rk-track{cursor:pointer;}',
        '.rk-row.rk-cannot .rk-track{cursor:not-allowed;}',
        '.rk-row.rk-can .rk-track:hover{background:rgba(255,255,255,.025);}',
        '.rk-row.rk-blocked .rk-track{opacity:.55;}',
        '.rk-row.rk-empty .rk-track::after{content:"";position:absolute;left:4px;right:4px;bottom:2px;height:1px;opacity:.5;',
        '  background:linear-gradient(90deg,rgba(255,236,200,.22) 0%,rgba(255,236,200,.08) 60%,rgba(255,236,200,.03) 100%);}',
        '.rk-row.rk-empty .rk-track::before{content:"";position:absolute;left:4px;bottom:2px;width:1px;height:7px;opacity:.5;background:rgba(255,236,200,.26);}',
        '.rk-row.rk-empty.rk-hint .rk-track::after{opacity:1;background:linear-gradient(90deg,rgba(255,193,7,.8) 0%,rgba(255,193,7,.35) 70%,rgba(255,193,7,.1) 100%);}',
        '.rk-row.rk-empty.rk-hint .rk-track::before{opacity:1;background:rgba(255,193,7,.8);}',
        '.rk-groove{position:absolute;left:2px;right:2px;border-radius:7px;pointer-events:none;',
        '  background:linear-gradient(180deg,rgba(0,0,0,.26) 0%,rgba(0,0,0,.14) 100%);',
        '  box-shadow:inset 0 2px 4px rgba(0,0,0,.45),inset 0 -1px 0 rgba(255,236,200,.05),0 1px 0 rgba(255,236,200,.04);}',
        '.rk-row.rk-full .rk-groove{box-shadow:inset 0 2px 4px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,193,7,.22),0 1px 0 rgba(255,236,200,.04);}',
        '.rk-row.rk-hint .rk-groove{box-shadow:inset 0 2px 4px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,193,7,.75),inset 0 0 14px rgba(255,193,7,.18);}',
        /* 卡片：左压右（z-index 自左向右递减），阴影落在右侧 */
        '.rk-card{position:absolute;left:0;top:0;border-radius:5px;border:1.5px solid var(--rk-card-border);background:var(--rk-card-bg);',
        '  box-shadow:3px 1px 5px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;transform-origin:50% 90%;',
        '  transition:transform .2s ease-out;}',
        '.rk-card img{width:90%;height:90%;object-fit:contain;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));pointer-events:none;}',
        '.rk-row.rk-can .rk-track:hover .rk-card.rk-next{border-color:var(--rk-accent);}',
        '.rk-card.rk-will{border-color:rgba(255,193,7,.8);background:linear-gradient(rgba(255,193,7,.2),rgba(255,193,7,.2)),linear-gradient(180deg,#16161a 0%,#20201f 100%);}',
        '.rk-card.rk-pop img{animation:rk-pop .32s cubic-bezier(.34,1.56,.64,1);}',
        '@keyframes rk-pop{0%{transform:translateY(-8px) scale(1.18);}100%{transform:translateY(0) scale(1);}}',
        /* 取出这一行：平时淡、无边框，悬停才高亮 */
        '.rk-take{flex:none;width:30px;height:30px;padding:0;border-radius:7px;display:flex;align-items:center;justify-content:center;cursor:pointer;',
        '  background:transparent;border:1px solid transparent;color:rgba(232,220,184,.30);font-family:inherit;}',
        '.rk-take:hover:not(.rk-off){background:rgba(255,193,7,.12);border-color:rgba(255,210,130,.5);color:#ffe8a8;}',
        '.rk-take.rk-off{color:rgba(232,220,184,.10);cursor:not-allowed;}',
        '.rk-take svg{width:17px;height:17px;display:block;pointer-events:none;}',
        '.rk-take-ph{flex:none;width:30px;}',
        /* 锁定这一行：锁上后取空也留着这一行，平时淡、锁上时常亮 */
        '.rk-lock{flex:none;width:30px;height:30px;padding:0;border-radius:7px;display:flex;align-items:center;justify-content:center;cursor:pointer;',
        '  background:transparent;border:1px solid transparent;color:rgba(232,220,184,.30);font-family:inherit;}',
        '.rk-lock:hover{background:rgba(255,193,7,.12);border-color:rgba(255,210,130,.5);color:#ffe8a8;}',
        '.rk-lock.rk-on{background:rgba(255,193,7,.10);border-color:rgba(255,210,130,.35);color:#ffd97a;}',
        '.rk-lock svg{width:16px;height:16px;display:block;pointer-events:none;}',
        '.rk-lock-ph{flex:none;width:30px;}',
        '.rk-row.rk-reserved .rk-groove{box-shadow:inset 0 2px 4px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,210,130,.20),0 1px 0 rgba(255,236,200,.04);}',
        '.rk-card.rk-ghost{opacity:.18;filter:grayscale(1);box-shadow:none;border-style:dashed;}',
        'html.quality-low .rk-card{transition:none;}',
        'html.quality-low .rk-card.rk-pop img{animation:none;}'
    ].join('\n');

    var TAKE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M12 16V4"/><path d="M8 8l4-4 4 4"/></svg>';

    /* 锁定这一行：锁上是闭合的锁，没锁是开着的锁 */
    var LOCK_ON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
    var LOCK_OFF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.6-1.4"/></svg>';

    var TRACK_PAD = 6;

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    function isLowQuality() {
        return document.documentElement.classList.contains('quality-low');
    }

    function div(cls) {
        var d = document.createElement('div');
        d.className = cls;
        return d;
    }

    function isEmptyRow(r) {
        return !(r && r.configId > 0);
    }

    /** 卡片转角的伪随机值（-1~1）：按「材料 + 行 + 位置」取种子，同一张卡刷新不抖 */
    function jitter(configId, k) {
        var x = Math.sin(configId * 12.9898 + k * 78.233) * 43758.5453;
        return (x - Math.floor(x)) * 2 - 1;
    }

    /**
     * @param host  挂载容器（清空后由本模块接管内容）
     * @param opts  {
     *   trackWidth:380, unit:42, rowHeight:52, gap:4, plateWidth:84, compact:false,
     *   takeButton: null | true | { disabled:function(row)->bool }   —— 行右侧「取出这一行」图标按钮
     *   onCardClick(row), onBlocked(row), onCardHover(row, isEnter),
     *   onTake(row), onTakeHover(row, isEnter)
     *   onCardRightClick(row)        —— 右键这一行（不传 = 右键无反应，另外三处面板保持原样）
     *   onCardDrag(row, mouseEvent)  —— 左键按住拖远：页面据此发起外部起拖（不传 = 不可拖）
     *   clickIsDetail: false         —— true 时单击只是看详情：不判能不能取出，也不走 onBlocked
     * }
     *   unit = 一格卡片的边长；2×1 卡片宽 = 2 × unit + 2
     */
    function createRackRows(host, opts) {
        ensureStyle();
        var o = {
            trackWidth: 380, unit: 42, rowHeight: 52, gap: 4, plateWidth: 84, compact: false,
            takeButton: null
        };
        for (var k in (opts || {})) o[k] = opts[k];

        var rows = [];
        var keys = [];
        var byKey = {};
        var els = {};
        var groups = [];
        var emptyEls = [];
        var signature = '';
        var prevRow = {}, prevTotal = {}, seeded = false;
        /* 刚起过拖的时刻：松手若正好落回原处会合成一次 click，这段时间内的 click 当拖拽的余波丢掉 */
        var dragFiredAt = 0;

        host.classList.add('rk-host');
        host.classList.toggle('rk-compact', !!o.compact);
        host.style.setProperty('--rk-gap', o.gap + 'px');

        /* 行身份 = 行号 + 材料（正常一行只有一种；还没重排的旧档里同一行混放时，C# 侧也拆成两行下发） */
        function keyOf(r, i) {
            return r.rowY !== undefined && r.rowY !== null ? 'y' + r.rowY + '_' + r.configId : 'i' + i;
        }

        function capOf(r) {
            return r.cap > 0 ? r.cap : Math.max(1, r.count || 0);
        }

        function canTake(r) {
            if (!(r.count > 0) || r.ok === false) return false;
            if (o.takeButton && r.fit !== undefined) return r.fit > 0;
            return true;
        }

        /* 按住某一行等它拖远。监听挂在 window 上、起拖或松手立刻摘掉，不留常驻监听 */
        function armDrag(ev, key) {
            var sx = ev.clientX, sy = ev.clientY, fired = false;
            function cleanup() {
                window.removeEventListener('mousemove', move);
                window.removeEventListener('mouseup', up);
            }
            function move(me) {
                if (fired) return;
                if (Math.abs(me.clientX - sx) < 5 && Math.abs(me.clientY - sy) < 5) return;
                fired = true;
                cleanup();
                var cur = byKey[key];
                if (!cur || !(cur.count > 0)) return;
                dragFiredAt = Date.now();
                if (o.onCardDrag) o.onCardDrag(cur, me);
            }
            function up() { cleanup(); }
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
        }

        function build() {
            host.innerHTML = '';
            els = {};
            groups = [];
            emptyEls = [];
            var i = 0, empties = 0;
            while (i < rows.length) {
                if (isEmptyRow(rows[i])) { empties++; i++; continue; }
                var configId = rows[i].configId;
                var g = { configId: configId, keys: [] };
                var grp = div('rk-grp');
                var plate = div('rk-plate');
                plate.style.width = o.plateWidth + 'px';
                g.nameEl = document.createElement('span');
                g.nameEl.className = 'rk-plate-name';
                g.countEl = document.createElement('span');
                g.countEl.className = 'rk-plate-count';
                plate.appendChild(g.nameEl);
                plate.appendChild(g.countEl);
                var col = div('rk-rows');
                grp.appendChild(plate);
                grp.appendChild(col);
                while (i < rows.length && !isEmptyRow(rows[i]) && rows[i].configId === configId) {
                    col.appendChild(buildRow(rows[i], keys[i]));
                    g.keys.push(keys[i]);
                    i++;
                }
                host.appendChild(grp);
                groups.push(g);
            }
            if (empties > 0) {
                var eg = div('rk-grp');
                var blank = div('rk-plate rk-blank');
                blank.style.width = o.plateWidth + 'px';
                var ecol = div('rk-rows');
                eg.appendChild(blank);
                eg.appendChild(ecol);
                for (var e = 0; e < empties; e++) ecol.appendChild(buildEmptyRow());
                host.appendChild(eg);
            }
        }

        function buildRow(r, key) {
            var h = r.h || 1, w = r.w || 1;
            var rh = h * o.rowHeight + (h - 1) * o.gap;
            var cw = w * o.unit + (w - 1) * 2, ch = h * o.unit + (h - 1) * 2;
            var gh = ch + 6, gtop = Math.round((rh - gh) / 2);

            var row = div('rk-row');
            row.style.height = rh + 'px';
            var track = div('rk-track');
            track.style.width = o.trackWidth + 'px';
            track.style.height = rh + 'px';
            var groove = div('rk-groove');
            groove.style.top = gtop + 'px';
            groove.style.height = gh + 'px';
            track.appendChild(groove);
            row.appendChild(track);

            var E = { row: row, track: track, cards: [], cw: cw, ch: ch, cardTop: gtop + 3 };

            if (o.takeButton) {
                // 不用 disabled 属性：禁用态的按钮收不到鼠标事件，悬停说明（背包已满）就出不来
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'rk-take';
                btn.innerHTML = TAKE_SVG;
                row.appendChild(btn);
                E.btn = btn;
                btn.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    var cur = byKey[key];
                    if (cur && o.onTake && !btn.classList.contains('rk-off')) o.onTake(cur);
                });
                btn.addEventListener('mouseenter', function () { var cur = byKey[key]; if (cur && o.onTakeHover) o.onTakeHover(cur, true); });
                btn.addEventListener('mouseleave', function () { var cur = byKey[key]; if (cur && o.onTakeHover) o.onTakeHover(cur, false); });
            }

            if (o.lockButton) {
                // 锁定这一行：锁上后这一行取空也留着（件数写 0），别的材料进不来
                var lockBtn = document.createElement('button');
                lockBtn.type = 'button';
                lockBtn.className = 'rk-lock';
                lockBtn.innerHTML = LOCK_OFF_SVG;
                row.appendChild(lockBtn);
                E.lockBtn = lockBtn;
                E.lockOn = false;
                lockBtn.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    var cur = byKey[key];
                    if (cur && o.onLock) o.onLock(cur);
                });
                lockBtn.addEventListener('mouseenter', function () { var cur = byKey[key]; if (cur && o.onLockHover) o.onLockHover(cur, true); });
                lockBtn.addEventListener('mouseleave', function () { var cur = byKey[key]; if (cur && o.onLockHover) o.onLockHover(cur, false); });
            }

            track.addEventListener('mousedown', function (ev) {
                var cur = byKey[key];
                if (!cur || !(cur.count > 0)) return;
                if (ev.button === 2) {
                    // 右键 = 快速转走一件（口径同背包面板右键快转）
                    ev.preventDefault();
                    if (!o.onCardRightClick) return;
                    if (canTake(cur)) o.onCardRightClick(cur);
                    else if (o.onBlocked) o.onBlocked(cur);
                    return;
                }
                if (ev.button !== 0 || !o.onCardDrag) return;
                armDrag(ev, key);
            });
            // 右键菜单交给上面那条 mousedown，这里只负责别让浏览器弹出来
            track.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

            track.addEventListener('click', function () {
                if (Date.now() - dragFiredAt < 400) return;
                var cur = byKey[key];
                if (!cur || !(cur.count > 0)) return;
                if (o.clickIsDetail) { if (o.onCardClick) o.onCardClick(cur); return; }
                if (canTake(cur)) { if (o.onCardClick) o.onCardClick(cur); }
                else if (o.onBlocked) o.onBlocked(cur);
            });
            track.addEventListener('mouseenter', function () { var cur = byKey[key]; if (cur && o.onCardHover) o.onCardHover(cur, true); });
            track.addEventListener('mouseleave', function () { var cur = byKey[key]; if (cur && o.onCardHover) o.onCardHover(cur, false); });

            els[key] = E;
            return row;
        }

        function buildEmptyRow() {
            var row = div('rk-row rk-empty');
            row.style.height = o.rowHeight + 'px';
            var track = div('rk-track');
            track.style.width = o.trackWidth + 'px';
            track.style.height = o.rowHeight + 'px';
            row.appendChild(track);
            if (o.takeButton) row.appendChild(div('rk-take-ph'));
            if (o.lockButton) row.appendChild(div('rk-lock-ph'));
            emptyEls.push({ row: row });
            return row;
        }

        function update(r, key) {
            var E = els[key];
            if (!E) return;
            var count = r.count || 0;
            var basis = Math.max(capOf(r), count);
            var can = canTake(r);
            E.row.classList.toggle('rk-can', count > 0 && can);
            E.row.classList.toggle('rk-cannot', count > 0 && !can);
            E.row.classList.toggle('rk-blocked', count > 0 && r.ok === false);
            E.row.classList.toggle('rk-full', r.cap > 0 && count >= r.cap);

            var step = basis > 1 ? Math.max(0, (o.trackWidth - TRACK_PAD * 2 - E.cw) / (basis - 1)) : 0;
            var maxDeg = (r.h || 1) > 1 ? 1.5 : 2.5;
            var seed = (r.rowY > 0 ? r.rowY : 0) * basis;
            // 钉住的空行画一张虚影卡，让人一眼看出这一行留给谁
            var ghost = count === 0 && !!r.locked;
            var want = ghost ? 1 : count;
            E.row.classList.toggle('rk-reserved', ghost);
            var cards = E.cards;
            while (cards.length < want) {
                var c = div('rk-card');
                c.style.width = E.cw + 'px';
                c.style.height = E.ch + 'px';
                c.style.top = E.cardTop + 'px';
                var img = document.createElement('img');
                img.draggable = false;
                c.appendChild(img);
                E.track.appendChild(c);
                cards.push(c);
            }
            while (cards.length > want) cards.pop().remove();
            for (var i = 0; i < cards.length; i++) {
                var card = cards[i];
                var im = card.firstChild;
                if (im && im.getAttribute('src') !== (r.icon || '')) im.setAttribute('src', r.icon || '');
                var deg = jitter(r.configId, seed + i) * maxDeg;
                card.style.zIndex = String(Math.max(1, count) - i);
                card.style.transform = 'translateX(' + (TRACK_PAD + i * step).toFixed(1) + 'px) rotate(' + deg.toFixed(2) + 'deg)';
                card.classList.toggle('rk-ghost', ghost);
                card.classList.toggle('rk-next', !ghost && i === cards.length - 1);
                card.classList.remove('rk-will');
            }

            if (E.btn) {
                var tb = o.takeButton;
                var off = tb && typeof tb.disabled === 'function' ? !!tb.disabled(r) : !can;
                E.btn.classList.toggle('rk-off', off);
            }

            if (E.lockBtn) {
                var lockOn = !!r.locked;
                if (E.lockOn !== lockOn) {
                    E.lockOn = lockOn;
                    E.lockBtn.innerHTML = lockOn ? LOCK_ON_SVG : LOCK_OFF_SVG;
                    E.lockBtn.classList.toggle('rk-on', lockOn);
                }
            }
        }

        function groupTotal(g) {
            var t = 0;
            for (var i = 0; i < g.keys.length; i++) t += byKey[g.keys[i]].count || 0;
            return t;
        }

        function popCard(card) {
            card.classList.remove('rk-pop');
            void card.offsetWidth;
            card.classList.add('rk-pop');
            setTimeout(function () { card.classList.remove('rk-pop'); }, 360);
        }

        /* 刚放进来的卡片弹一下。先认已有行里多出来的卡；剩下的件数算在新出现的行上（从组尾往前）——
           放入偶尔会让材料架内部把行往上挤紧，行号整体变化，此时按组总数差定件数，不会整片乱弹 */
        function popAdded() {
            if (!seeded || isLowQuality()) return;
            for (var gi = 0; gi < groups.length; gi++) {
                var g = groups[gi];
                var budget = groupTotal(g) - (prevTotal[g.configId] || 0);
                if (budget <= 0) continue;
                var j, cards;
                for (var a = 0; a < g.keys.length && budget > 0; a++) {
                    var before = prevRow[g.keys[a]];
                    if (before === undefined) continue;
                    cards = els[g.keys[a]].cards;
                    for (j = before; j < cards.length && budget > 0; j++) { popCard(cards[j]); budget--; }
                }
                for (var b = g.keys.length - 1; b >= 0 && budget > 0; b--) {
                    if (prevRow[g.keys[b]] !== undefined) continue;
                    cards = els[g.keys[b]].cards;
                    for (j = cards.length - 1; j >= 0 && budget > 0; j--) { popCard(cards[j]); budget--; }
                }
            }
        }

        function remember() {
            prevRow = {};
            prevTotal = {};
            for (var gi = 0; gi < groups.length; gi++) {
                var g = groups[gi];
                for (var i = 0; i < g.keys.length; i++) prevRow[g.keys[i]] = byKey[g.keys[i]].count || 0;
                prevTotal[g.configId] = groupTotal(g);
            }
            seeded = true;
        }

        return {
            /** 整体刷新行数据；行结构不变时原地更新 */
            render: function (list) {
                rows = list || [];
                keys = [];
                byKey = {};
                var sig = [];
                for (var i = 0; i < rows.length; i++) {
                    var r = rows[i];
                    if (isEmptyRow(r)) { keys.push(''); sig.push('e'); continue; }
                    var key = keyOf(r, i);
                    keys.push(key);
                    byKey[key] = r;
                    sig.push(key + ':' + r.configId + ':' + (r.w || 1) + 'x' + (r.h || 1));
                }
                var s = sig.join('|');
                if (s !== signature) { signature = s; build(); }
                for (var n = 0; n < rows.length; n++) if (keys[n]) update(rows[n], keys[n]);
                for (var gi = 0; gi < groups.length; gi++) {
                    var g = groups[gi], first = byKey[g.keys[0]];
                    g.nameEl.textContent = (first && first.name) || '';
                    g.countEl.textContent = groupTotal(g);
                }
                popAdded();
                remember();
            },
            getRows: function () { return rows; },
            /** 行身份（取卡片 / 高亮时用）；传入 render 过的行对象 */
            keyOf: function (row) {
                for (var i = 0; i < rows.length; i++) if (rows[i] === row) return keys[i];
                return row ? keyOf(row, -1) : '';
            },
            getRow: function (key) { return byKey[key] || null; },
            /** 某行当前画出来的卡片（最后一张 = 下一件被取走的那张） */
            getCards: function (key) { return els[key] ? els[key].cards : []; },
            /** 拖拽拿起时高亮这件材料会落进的那一行：同种材料第一个没满的行，否则第一条空行；传 0 则全清 */
            setDropHint: function (configId) {
                var id, e;
                for (id in els) els[id].row.classList.remove('rk-hint');
                for (e = 0; e < emptyEls.length; e++) emptyEls[e].row.classList.remove('rk-hint');
                if (!configId) return;
                var target = null;
                for (var gi = 0; gi < groups.length && !target; gi++) {
                    var g = groups[gi];
                    if (String(g.configId) !== String(configId)) continue;
                    for (var i = 0; i < g.keys.length; i++) {
                        var r = byKey[g.keys[i]];
                        if (!(r.cap > 0) || (r.count || 0) < r.cap) { target = els[g.keys[i]].row; break; }
                    }
                }
                if (!target && emptyEls.length) target = emptyEls[0].row;
                if (target) target.classList.add('rk-hint');
            },
            /** 高亮某行最后 n 张（「取出这一行」悬停预告） */
            markWill: function (key, n) {
                var cards = els[key] ? els[key].cards : [];
                for (var i = Math.max(0, cards.length - n); i < cards.length; i++) cards[i].classList.add('rk-will');
            },
            clearWill: function () {
                for (var id in els) {
                    var cards = els[id].cards;
                    for (var i = 0; i < cards.length; i++) cards[i].classList.remove('rk-will');
                }
            },
            /** 视口坐标是否落在整个分行区域内（拖拽落点判定用，被拖元素盖在鼠标下，不能用 elementFromPoint） */
            hit: function (x, y) {
                var r = host.getBoundingClientRect();
                return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
            },
            /** 清掉件数记忆（切页签时调，避免切回来被当成「刚放进来」弹一下） */
            resetCounts: function () { prevRow = {}; prevTotal = {}; seeded = false; }
        };
    }

    global.createRackRows = createRackRows;
})(window);
