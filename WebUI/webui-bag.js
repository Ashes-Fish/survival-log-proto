(function(global) {
    'use strict';

    function getBodyZoom() {
        return parseFloat(window.getComputedStyle(document.body).zoom) || 1;
    }

    /* ══════ 拖放统一规则：落点被占时 交换 / 挤开 ══════
       planBagDrop 与 C# 侧的规划算法逐行对应，两边用同一套用例对拍；改规则必须两边一起改。
       判定顺序：落点全空 → 放下；光标格上的物品与拖动物品同尺寸 → 交换；
       落点里至少有 1 个空格、挡路的不超过 maxPush 件、每件都能在同一容器里找到空位 → 挤开；其余放不下。
       挡路物品按面积从大到小，依次找离原位曼哈顿距离最近的空位（同距离按行优先取先扫到的）。
       items 不含拖动物品本身；坐标 x = 列、y = 行。 */
    var SMART_MAX_PUSH = 3;

    function planBagDrop(cols, rows, items, dragW, dragH, px, py, cx, cy, allowSwap, allowPush, maxPush) {
        var plan = { kind: 'reject', targetId: null, moves: [], reason: '' };
        if (cols <= 0 || rows <= 0 || dragW <= 0 || dragH <= 0) { plan.reason = 'invalid size'; return plan; }
        if (px < 0 || py < 0 || px + dragW > cols || py + dragH > rows) { plan.reason = 'out of bounds'; return plan; }

        var blockers = [], covered = 0, i;
        for (i = 0; i < items.length; i++) {
            var a = overlapArea(items[i], px, py, dragW, dragH);
            if (a > 0) { blockers.push(items[i]); covered += a; }
        }
        if (blockers.length === 0) { plan.kind = 'place'; return plan; }

        for (i = 0; i < items.length; i++) {
            var it = items[i];
            if (!(cx >= it.x && cx < it.x + it.w && cy >= it.y && cy < it.y + it.h)) continue;
            if (it.w === dragW && it.h === dragH) {
                if (allowSwap) { plan.kind = 'swap'; plan.targetId = it.id; }
                else plan.reason = 'swap disabled';
                return plan;
            }
            break;
        }

        if (!allowPush) { plan.reason = 'push disabled'; return plan; }
        if (blockers.length > maxPush) { plan.reason = 'too many blockers'; return plan; }
        if (covered >= dragW * dragH) { plan.reason = 'no empty cell in target'; return plan; }

        var occ = [];
        for (i = 0; i < cols * rows; i++) occ.push(false);
        for (i = 0; i < items.length; i++) {
            if (blockers.indexOf(items[i]) >= 0) continue;
            markOcc(occ, cols, rows, items[i].x, items[i].y, items[i].w, items[i].h);
        }
        markOcc(occ, cols, rows, px, py, dragW, dragH);

        var order = blockers.slice();
        for (i = 1; i < order.length; i++) {   // 稳定的按面积降序（与 C# 插入排序一致）
            var cur = order[i], area = cur.w * cur.h, j = i - 1;
            while (j >= 0 && order[j].w * order[j].h < area) { order[j + 1] = order[j]; j--; }
            order[j + 1] = cur;
        }
        for (i = 0; i < order.length; i++) {
            var b = order[i], best = null, bestDist = Infinity;
            for (var y = 0; y <= rows - b.h; y++) {
                for (var x = 0; x <= cols - b.w; x++) {
                    var d = Math.abs(x - b.x) + Math.abs(y - b.y);
                    if (d >= bestDist) continue;
                    if (!fitsOcc(occ, cols, rows, x, y, b.w, b.h)) continue;
                    bestDist = d; best = { x: x, y: y };
                }
            }
            if (!best) { plan.moves = []; plan.reason = 'blocker has no room'; return plan; }
            markOcc(occ, cols, rows, best.x, best.y, b.w, b.h);
            plan.moves.push({ id: b.id, x: best.x, y: best.y });
        }
        plan.kind = 'push';
        return plan;
    }

    function overlapArea(it, x, y, w, h) {
        var ox = Math.min(it.x + it.w, x + w) - Math.max(it.x, x);
        var oy = Math.min(it.y + it.h, y + h) - Math.max(it.y, y);
        return ox > 0 && oy > 0 ? ox * oy : 0;
    }
    function markOcc(occ, cols, rows, x, y, w, h) {
        for (var i = x; i < x + w; i++) for (var j = y; j < y + h; j++) {
            if (i >= 0 && j >= 0 && i < cols && j < rows) occ[j * cols + i] = true;
        }
    }
    function fitsOcc(occ, cols, rows, x, y, w, h) {
        if (x < 0 || y < 0 || x + w > cols || y + h > rows) return false;
        for (var i = x; i < x + w; i++) for (var j = y; j < y + h; j++) if (occ[j * cols + i]) return false;
        return true;
    }

    /* 各容器能否交换 / 挤开：起拖时向 Unity 查询，回包按 ownerId 缓存。没查到 = 不启用（等同旧行为：被占即回弹） */
    var POLICY_MSG = '__BAG_DROP_POLICY__';
    var _dropPolicy = {};
    function requestDropPolicy(ownerIds) {
        var owners = [];
        for (var i = 0; i < ownerIds.length; i++) if (ownerIds[i]) owners.push(ownerIds[i]);
        if (!owners.length || !window.parent || window.parent === window) return;
        try { window.parent.postMessage({ type: POLICY_MSG, data: { owners: owners } }, '*'); } catch (e) { }
    }
    function getDropPolicy(ownerId) {
        return _dropPolicy[String(ownerId)] || null;
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('message', function(event) {
            var msg = event.data;
            if (!msg || msg.type !== POLICY_MSG) return;
            var d = msg.data;
            if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
            if (!d || !d.owners) return;
            if (!d.on) { _dropPolicy = {}; return; }
            for (var k in d.owners) _dropPolicy[k] = { swap: !!d.owners[k].s, push: !!d.owners[k].p };
        });
    }

    /* 预览与提示的样式只注入一次；各面板不必改 CSS */
    var _smartStyleDone = false;
    function ensureSmartDropStyle() {
        if (_smartStyleDone || typeof document === 'undefined') return;
        _smartStyleDone = true;
        var st = document.createElement('style');
        st.textContent =
            '.slot.smart-hover{background:rgba(255,196,0,0.30)!important;box-shadow:inset 0 0 0 2px rgba(255,196,0,0.85)!important;}' +
            '.item.smart-push{outline:2px dashed rgba(255,196,0,0.95);outline-offset:-2px;}' +
            '.item.smart-pending{opacity:0.55;}' +
            '.item .smart-flash{position:absolute;left:0;top:0;right:0;bottom:0;border:2px solid rgba(255,204,64,1);border-radius:4px;' +
            'box-shadow:0 0 10px rgba(255,204,64,0.9);pointer-events:none;z-index:6;opacity:0;animation:smartMovedFlash 1.1s ease-out 1;}' +
            '@keyframes smartMovedFlash{0%{opacity:1;}100%{opacity:0;}}';
        (document.head || document.documentElement).appendChild(st);
    }

    /* 交换 / 挤开后被挪动的物品：下一次重绘时闪一下金边 */
    var _flashUntil = {};
    function markFlash(ids) {
        var until = Date.now() + 2000;
        for (var i = 0; i < ids.length; i++) _flashUntil[String(ids[i])] = until;
    }

    function createGridBag(containerId, config) {
        let items = [];
        let ownerId = 0;
        const cfg = {
            slotSize: 40,
            gap: 6,
            padding: 10,
            cols: 6,
            rows: 5,
            ...config
        };

        let _onMouseDown = null;
        let _onMouseEnter = null;
        let _onMouseLeave = null;
        let _onClick = null;

        let _highlightedSlots = [];
        let _cachedDomSlots = null;
        let _cachedContainer = null;

        let _pendingItems = null;
        let _dragHold = false;
        /* 拖拽期间收到的最新格子：不重绘（会拆掉手上那件的 DOM），但落点占位判定与交换 / 挤开预测按它算，
           否则松手时拿的是起拖那一刻的旧布局 —— 拖动途中被快转 / 填料 / 成品落袋占掉的格子会被当成空格 */
        let _dragModel = null;
        function collisionItems() { return _dragModel || items; }

        function mapItem(backendItem) {
            const w = backendItem.w || 1;
            const h = backendItem.h || 1;
            const pixelW = w * cfg.slotSize + (w - 1) * cfg.gap;
            const pixelH = h * cfg.slotSize + (h - 1) * cfg.gap;

            const iconHtml = backendItem.icon
                ? '<img src="' + backendItem.icon + '" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:contain;pointer-events:none;" onerror="this.outerHTML=\'📦\'">'
                : '📦';
            const storyMarkHtml = backendItem.hasStory
                ? '<svg class="story-mark" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:2px;right:2px;width:16px;height:16px;pointer-events:none;z-index:3;filter:drop-shadow(0 0 2px rgba(0,0,0,0.9));"><circle cx="10" cy="10" r="6" fill="none" stroke="#FFE066" stroke-width="2.5"/><line x1="14.5" y1="14.5" x2="20" y2="20" stroke="#FFE066" stroke-width="3" stroke-linecap="round"/></svg>'
                : '';

            return {
                id: backendItem.itemId.toString(),
                x: backendItem.x,
                y: backendItem.y,
                w: w,
                h: h,
                containerId: containerId,
                content: iconHtml + storyMarkHtml,
                style: 'width:' + pixelW + 'px;height:' + pixelH + 'px;',
                name: backendItem.name || '',
                desc: backendItem.desc || '',
                count: backendItem.count || 1,
                useTimes: typeof backendItem.useTimes === 'number' ? backendItem.useTimes : 0,
                useTimesMax: typeof backendItem.useTimesMax === 'number' ? backendItem.useTimesMax : 0,
                quality: backendItem.quality || 0,
                _raw: backendItem
            };
        }

        var QUALITY_CLASSES = { 1: 'q-perfect', 2: 'q-good', 3: 'q-normal', 4: 'q-fail' };

        function initGrid() {
            var container = document.getElementById(containerId);
            if (!container) return;
            container.innerHTML = '';
            container.style.gridTemplateColumns = 'repeat(' + cfg.cols + ', ' + cfg.slotSize + 'px)';
            container.style.gridTemplateRows = 'repeat(' + cfg.rows + ', ' + cfg.slotSize + 'px)';
            for (var i = 0; i < cfg.rows * cfg.cols; i++) {
                var slot = document.createElement('div');
                slot.classList.add('slot');
                container.appendChild(slot);
            }
            renderItems();
        }

        function renderItems() {
            var container = document.getElementById(containerId);
            if (!container) return;

            var oldItems = container.querySelectorAll('.item, .grid-item');
            for (var i = 0; i < oldItems.length; i++) oldItems[i].remove();

            items.forEach(function(itemData) {
                var el = document.createElement('div');
                el.classList.add('item');
                if (itemData.quality && QUALITY_CLASSES[itemData.quality]) {
                    el.classList.add(QUALITY_CLASSES[itemData.quality]);
                }
                el.innerHTML = itemData.content;
                el.id = itemData.id;
                if (itemData.style) el.style.cssText += itemData.style;

                var left = cfg.padding + (itemData.x * (cfg.slotSize + cfg.gap));
                var top = cfg.padding + (itemData.y * (cfg.slotSize + cfg.gap));
                el.style.left = left + 'px';
                el.style.top = top + 'px';
                el.style.position = 'absolute';
                el.style.zIndex = 10;
                el.style.cursor = 'grab';
                el.style.display = 'flex';
                el.style.justifyContent = 'center';
                el.style.alignItems = 'center';

                if (_onMouseDown) {
                    el.addEventListener('mousedown', function(e) { _onMouseDown(e, itemData, el); });
                    el.addEventListener('touchstart', function(e) { _onMouseDown(e, itemData, el); }, { passive: false });
                    el.addEventListener('contextmenu', function(e) { e.preventDefault(); });
                }
                if (_onMouseEnter) {
                    el.addEventListener('mouseenter', function(e) { _onMouseEnter(e, itemData); });
                }
                if (_onMouseLeave) {
                    el.addEventListener('mouseleave', function(e) { _onMouseLeave(e, itemData); });
                }
                if (_onClick) {
                    el.addEventListener('click', function(e) { _onClick(e, itemData); });
                }

                if (itemData.count > 1) {
                    var countEl = document.createElement('span');
                    countEl.className = 'item-count';
                    countEl.textContent = 'x' + itemData.count;
                    el.appendChild(countEl);
                }

                if (itemData.useTimesMax > 1 && itemData.useTimes >= 0) {
                    var ratio = Math.max(0, Math.min(1, itemData.useTimes / itemData.useTimesMax));
                    var barColor = ratio > 0.6 ? '#4CAF50' : (ratio > 0.3 ? '#FFC107' : '#F44336');

                    var useEl = document.createElement('span');
                    useEl.className = 'item-use';
                    useEl.textContent = itemData.useTimes + '/' + itemData.useTimesMax;
                    useEl.style.cssText = 'position:absolute;bottom:5px;left:3px;font-size:10px;font-weight:700;color:#fff;background:rgba(0,0,0,0.7);border:1px solid rgba(255,255,255,0.12);padding:0 5px;border-radius:8px;line-height:13px;text-shadow:0 1px 2px rgba(0,0,0,0.85);box-shadow:0 1px 3px rgba(0,0,0,0.45);font-variant-numeric:tabular-nums;pointer-events:none;z-index:4;';
                    el.appendChild(useEl);

                    var barWrap = document.createElement('div');
                    barWrap.className = 'item-use-bar';
                    barWrap.style.cssText = 'position:absolute;left:2px;right:2px;bottom:0;height:2px;background:rgba(0,0,0,0.55);border-radius:1px;overflow:hidden;pointer-events:none;z-index:4;';
                    var barFill = document.createElement('div');
                    barFill.style.cssText = 'height:100%;width:100%;transform:scaleX(' + ratio + ');transform-origin:left;background:' + barColor + ';transition:transform 0.2s;';
                    barWrap.appendChild(barFill);
                    el.appendChild(barWrap);
                }

                if (_flashUntil[itemData.id]) {
                    if (_flashUntil[itemData.id] > Date.now()) {
                        var flashEl = document.createElement('span');
                        flashEl.className = 'smart-flash';
                        el.appendChild(flashEl);
                    }
                    delete _flashUntil[itemData.id];
                }

                if (cfg.onItemRendered) {
                    cfg.onItemRendered(el, itemData);
                }

                container.appendChild(el);
            });
        }

        function getOccupiedSlots(startRow, startCol, w, h) {
            var slots = [];
            for (var i = 0; i < h; i++) {
                for (var j = 0; j < w; j++) {
                    slots.push({ r: startRow + i, c: startCol + j });
                }
            }
            return slots;
        }

        function checkValidity(coords, currentItemId) {
            for (var k = 0; k < coords.length; k++) {
                var coord = coords[k];
                if (coord.c < 0 || coord.c >= cfg.cols || coord.r < 0 || coord.r >= cfg.rows) return false;
            }
            var list = collisionItems();
            for (var m = 0; m < list.length; m++) {
                var item = list[m];
                if (item.id === currentItemId) continue;
                if (item.containerId !== containerId) continue;
                for (var n = 0; n < coords.length; n++) {
                    var slot = coords[n];
                    if (slot.c >= item.x && slot.c < item.x + item.w &&
                        slot.r >= item.y && slot.r < item.y + item.h) {
                        return false;
                    }
                }
            }
            return true;
        }

        function _getDomSlots() {
            if (_cachedDomSlots) return _cachedDomSlots;
            var container = _cachedContainer || document.getElementById(containerId);
            if (!container) return null;
            return container.querySelectorAll('.slot');
        }

        function highlightSlots(coords, isValid) {
            var domSlots = _getDomSlots();
            if (!domSlots) return;
            // isValid 传 'smart' = 挤开预览（黄色）
            var className = isValid === 'smart' ? 'smart-hover' : (isValid ? 'valid-hover' : 'invalid-hover');

            var newSet = {};
            for (var i = 0; i < coords.length; i++) {
                var coord = coords[i];
                if (coord.c >= 0 && coord.c < cfg.cols && coord.r >= 0 && coord.r < cfg.rows) {
                    newSet[coord.r * cfg.cols + coord.c] = className;
                }
            }

            for (var k = _highlightedSlots.length - 1; k >= 0; k--) {
                var old = _highlightedSlots[k];
                if (newSet[old.index] !== old.className) {
                    if (domSlots[old.index]) domSlots[old.index].classList.remove(old.className);
                    _highlightedSlots.splice(k, 1);
                } else {
                    delete newSet[old.index];
                }
            }

            for (var idx in newSet) {
                var index = parseInt(idx);
                if (domSlots[index]) {
                    domSlots[index].classList.add(newSet[idx]);
                    _highlightedSlots.push({ index: index, className: newSet[idx] });
                }
            }
        }

        function clearHighlights() {
            if (_highlightedSlots.length === 0) return;
            var domSlots = _getDomSlots();
            if (!domSlots) { _highlightedSlots = []; return; }
            for (var i = 0; i < _highlightedSlots.length; i++) {
                var h = _highlightedSlots[i];
                if (domSlots[h.index]) domSlots[h.index].classList.remove(h.className);
            }
            _highlightedSlots = [];
        }

        function getGridCoordinates(clientX, clientY, itemW, itemH, cachedRect, zoomOpt) {
            var rect = cachedRect;
            if (!rect) {
                var container = _cachedContainer || document.getElementById(containerId);
                if (!container) return { row: 0, col: 0 };
                rect = container.getBoundingClientRect();
            }
            var zoom = zoomOpt || getBodyZoom();
            var mouseX = (clientX - rect.left) / zoom - cfg.padding;
            var mouseY = (clientY - rect.top) / zoom - cfg.padding;
            var step = cfg.slotSize + cfg.gap;
            var itemPixelW = itemW * cfg.slotSize + (itemW - 1) * cfg.gap;
            var itemPixelH = itemH * cfg.slotSize + (itemH - 1) * cfg.gap;
            var virtualLeft = mouseX - (itemPixelW / 2);
            var virtualTop = mouseY - (itemPixelH / 2);
            return { row: Math.round(virtualTop / step), col: Math.round(virtualLeft / step) };
        }

        /* 光标所在的格子（交换 / 合并对象按它找）；与按物品中心算落点的 getGridCoordinates 不同 */
        function getCursorCell(clientX, clientY, cachedRect, zoomOpt) {
            var rect = cachedRect;
            if (!rect) {
                var container = _cachedContainer || document.getElementById(containerId);
                if (!container) return { row: -1, col: -1 };
                rect = container.getBoundingClientRect();
            }
            var zoom = zoomOpt || getBodyZoom();
            var step = cfg.slotSize + cfg.gap;
            var mx = (clientX - rect.left) / zoom - cfg.padding;
            var my = (clientY - rect.top) / zoom - cfg.padding;
            return { row: Math.floor(my / step), col: Math.floor(mx / step) };
        }

        /* 本容器内除 exceptId 外的物品，换成规划算法要的形状 */
        function getPlanItems(exceptId) {
            var out = [];
            var src = collisionItems();
            for (var i = 0; i < src.length; i++) {
                var it = src[i];
                if (it.id === exceptId || it.containerId !== containerId) continue;
                out.push({ id: it.id, x: it.x, y: it.y, w: it.w, h: it.h, ref: it });
            }
            return out;
        }

        /* 挤开预览：给挡路物品描虚线（只 toggle class，不重建 DOM） */
        var _pushMarked = [];
        function markPushItems(ids) {
            for (var i = 0; i < _pushMarked.length; i++) {
                var old = document.getElementById(_pushMarked[i]);
                if (old) old.classList.remove('smart-push');
            }
            _pushMarked = ids ? ids.slice() : [];
            for (var j = 0; j < _pushMarked.length; j++) {
                var el = document.getElementById(_pushMarked[j]);
                if (el) el.classList.add('smart-push');
            }
        }

        function isMouseOver(clientX, clientY, cachedRect) {
            var rect = cachedRect;
            if (!rect) {
                var container = _cachedContainer || document.getElementById(containerId);
                if (!container) return false;
                rect = container.getBoundingClientRect();
            }
            return clientX >= rect.left && clientX <= rect.right &&
                   clientY >= rect.top && clientY <= rect.bottom;
        }

        function findEmptySpot(w, h) {
            for (var r = 0; r <= cfg.rows - h; r++) {
                for (var c = 0; c <= cfg.cols - w; c++) {
                    var coords = getOccupiedSlots(r, c, w, h);
                    if (checkValidity(coords, '-1')) {
                        return { x: c, y: r };
                    }
                }
            }
            return null;
        }

        return {
            refresh: function(backendItems) {
                if (_dragHold) {
                    _pendingItems = backendItems;
                    _dragModel = backendItems ? backendItems.map(mapItem) : null;
                    return;
                }
                items = backendItems.map(mapItem);
                initGrid();
            },
            /* 拖拽中只更新判定用的格子、不排重绘：给自己攒整包消息、松手后统一应用的面板用（如 ToolTable）。
               不在拖拽中调用无效；松手 _flushPendingRefresh 时清空 */
            setDragModel: function(backendItems) {
                if (_dragHold && backendItems) _dragModel = backendItems.map(mapItem);
            },
            resize: function(cols, rows) {
                cfg.cols = cols;
                cfg.rows = rows;
            },
            setOwnerId: function(id) { ownerId = id; },
            getOwnerId: function() { return ownerId; },
            getItems: function() { return items; },
            getContainerId: function() { return containerId; },
            getConfig: function() { return cfg; },
            initGrid: initGrid,
            renderItems: renderItems,
            getOccupiedSlots: getOccupiedSlots,
            checkValidity: checkValidity,
            highlightSlots: highlightSlots,
            clearHighlights: clearHighlights,
            /* 同类预览高亮（2026-09-23）：按住高亮键悬停某件时，把本栏同类的格子一起描边。
               传一个 id 的 Set（元素类型要与 item DOM 的 id 一致，都是字符串），传空 / null = 全部熄掉。
               直接 toggle 已有 DOM 的 class，不走 renderItems —— hover 是 60Hz 热路径，
               每次悬停换格重建整栏 DOM 会掉帧。容器上的 kin-active 交给各面板自己的 CSS 收口。 */
            setKinHint: function(idSet) {
                var container = _cachedContainer || document.getElementById(containerId);
                if (!container) return;
                var on = !!(idSet && idSet.size);
                container.classList.toggle('kin-active', on);
                var els = container.querySelectorAll('.item');
                for (var i = 0; i < els.length; i++) {
                    els[i].classList.toggle('kin-hint', on && idSet.has(els[i].id));
                }
            },
            getGridCoordinates: getGridCoordinates,
            getCursorCell: getCursorCell,
            getPlanItems: getPlanItems,
            markPushItems: markPushItems,
            isMouseOver: isMouseOver,
            findEmptySpot: findEmptySpot,
            _setCallbacks: function(callbacks) {
                _onMouseDown = callbacks.onMouseDown || null;
                _onMouseEnter = callbacks.onMouseEnter || null;
                _onMouseLeave = callbacks.onMouseLeave || null;
                _onClick = callbacks.onClick || null;
            },
            _beginDragCache: function() {
                _dragHold = true;
                _cachedContainer = document.getElementById(containerId);
                _cachedDomSlots = _cachedContainer ? _cachedContainer.querySelectorAll('.slot') : null;
                return _cachedContainer ? _cachedContainer.getBoundingClientRect() : null;
            },
            _endDragCache: function() {
                _cachedContainer = null;
                _cachedDomSlots = null;
            },
            _flushPendingRefresh: function() {
                _dragHold = false;
                _dragModel = null;
                if (!_pendingItems) return false;
                items = _pendingItems.map(mapItem);
                _pendingItems = null;
                initGrid();
                return true;
            },
            updateItemPosition: function(itemId, newContainerId, col, row) {
                var idx = -1;
                for (var i = 0; i < items.length; i++) {
                    if (items[i].id === itemId) { idx = i; break; }
                }
                if (idx > -1) {
                    items[idx].x = col;
                    items[idx].y = row;
                    items[idx].containerId = newContainerId;
                }
            },
            removeItem: function(itemId) {
                for (var i = items.length - 1; i >= 0; i--) {
                    if (items[i].id === itemId) { items.splice(i, 1); break; }
                }
            }
        };
    }

    function createBagDragCoordinator(bags, callbacks) {
        var isDragging = false;
        var hasDragged = false;
        var isHoisted = false;
        var dragStartX = 0, dragStartY = 0;
        var dragInitialLeft = 0, dragInitialTop = 0;
        var draggedItemData = null;
        var dropInterceptor = null;
        var draggedEl = null;
        var tooltipTimer = null;
        var TOOLTIP_DELAY = 500;

        var HOVER_IDLE_DELAY = 100;
        var HOVER_IDLE_THRESHOLD_RATIO = 0.25;
        var _hoverIdleThreshold = 10;
        var _bagRects = null;
        var _latestPos = null;
        var _rafId = 0;
        var _idleTimer = null;
        var _hoverDirty = false;
        var _prevFramePos = null;
        var _dragZoom = 1;

        bags.forEach(function(bag) {
            bag._setCallbacks({
                onMouseDown: startDrag,
                onMouseEnter: handleMouseEnter,
                onMouseLeave: handleMouseLeave,
                onClick: handleClick
            });
        });

        function getClientXY(e) {
            var x = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
            var y = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
            return { x: x, y: y };
        }

        function getChangedClientXY(e) {
            var x = e.clientX || (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0);
            var y = e.clientY || (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : 0);
            return { x: x, y: y };
        }

        function handleClick(e, itemData) {
            if (hasDragged) return;
            if (callbacks.onItemClick) {
                callbacks.onItemClick(parseInt(itemData.id));
            }
        }

        function handleMouseEnter(e, itemData) {
            if (isDragging) return;
            if (tooltipTimer) clearTimeout(tooltipTimer);
            tooltipTimer = setTimeout(function() {
                if (callbacks.onItemHover) {
                    callbacks.onItemHover(parseInt(itemData.id), true);
                }
            }, TOOLTIP_DELAY);
        }

        function handleMouseLeave(e, itemData) {
            if (tooltipTimer) clearTimeout(tooltipTimer);
            if (!isDragging && itemData && callbacks.onItemHover) {
                callbacks.onItemHover(parseInt(itemData.id), false);
            }
        }

        /**
         * 从格子背包之外的地方起拖（材料架的一行、货架上的卡片……）：造一个跟手的幽灵，
         * 落点判定复用格子背包这一套（格子换算 + 占位校验 + 落点高亮）。
         * 松手只回调 onExternalDrop，**不动前端数据** —— 外部来源的真身不在任何一个 bag 里，
         * 乐观改会凭空造出一件；两侧都等 Logic 刷新回来再画（口径同材料架放入：一律回弹不乐观移除）。
         * 起拖阈值由调用方把关（行卡片按下后移动够远才叫），进到这里就是真拖。
         * @param data { id, icon, w, h, payload } —— payload 原样回传给 onExternalDrop
         * @return 起拖成功与否（正在拖别的东西时不受理）
         */
        function beginExternalDrag(e, data) {
            if (isDragging || !data) return false;

            var pos = getClientXY(e);
            _dragZoom = getBodyZoom();
            var cfg0 = bags[0] ? bags[0].getConfig() : null;
            var slot = cfg0 && cfg0.slotSize ? cfg0.slotSize : 50;
            var gap = cfg0 && cfg0.gap ? cfg0.gap : 4;
            var w = data.w || 1, h = data.h || 1;
            var gw = w * slot + (w - 1) * gap, gh = h * slot + (h - 1) * gap;

            var ghost = document.createElement('div');
            ghost.className = 'item';
            ghost.setAttribute('data-no-sync', '');
            ghost.style.cssText = 'position:fixed;z-index:9999;display:flex;align-items:center;justify-content:center;pointer-events:none;';
            ghost.style.width = gw + 'px';
            ghost.style.height = gh + 'px';
            if (data.icon) {
                var gimg = document.createElement('img');
                gimg.src = data.icon;
                gimg.draggable = false;
                gimg.style.cssText = 'width:90%;height:90%;object-fit:contain;pointer-events:none;';
                ghost.appendChild(gimg);
            }
            document.body.appendChild(ghost);

            var left = pos.x / _dragZoom - gw / 2, top = pos.y / _dragZoom - gh / 2;
            ghost.style.left = left + 'px';
            ghost.style.top = top + 'px';

            // x/y 给 -1：它不在任何格子里，回弹分支（按 x/y 算原位）永远够不到它
            draggedItemData = { id: data.id, w: w, h: h, x: -1, y: -1, containerId: '', icon: data.icon,
                _external: true, _payload: data.payload || data };
            draggedEl = ghost;
            isDragging = true;
            hasDragged = true;
            isHoisted = true;
            dragStartX = pos.x;
            dragStartY = pos.y;
            dragInitialLeft = left;
            dragInitialTop = top;
            _latestPos = pos;
            _bagRects = bags.map(function(bag) { return bag._beginDragCache(); });
            _hoverIdleThreshold = slot * HOVER_IDLE_THRESHOLD_RATIO;
            if (tooltipTimer) clearTimeout(tooltipTimer);

            window.addEventListener('mouseup', stopDrag);
            window.addEventListener('touchend', stopDrag);
            scheduleFrame();
            return true;
        }

        function startDrag(e, itemData, element) {
            if (e.button === 2) {
                e.preventDefault();
                if (isDragging) return;
                if (tooltipTimer) clearTimeout(tooltipTimer);
                if (callbacks.onItemClick) callbacks.onItemClick(parseInt(itemData.id), true);
                return;
            }
            if (e.button !== undefined && e.button !== 0) return;
            isDragging = true;
            hasDragged = false;
            isHoisted = false;
            draggedItemData = itemData;
            draggedEl = element;
            element.setAttribute('data-no-sync', '');
            _dragZoom = getBodyZoom();

            var pos = getClientXY(e);
            dragStartX = pos.x;
            dragStartY = pos.y;
            _latestPos = pos;

            var style = window.getComputedStyle(element);
            dragInitialLeft = parseInt(style.left) || 0;
            dragInitialTop = parseInt(style.top) || 0;

            element.style.zIndex = 100;

            _bagRects = bags.map(function(bag) { return bag._beginDragCache(); });

            var cfg0 = bags[0] ? bags[0].getConfig() : null;
            _hoverIdleThreshold = (cfg0 && cfg0.slotSize ? cfg0.slotSize : 50) * HOVER_IDLE_THRESHOLD_RATIO;

            if (tooltipTimer) clearTimeout(tooltipTimer);

            window.addEventListener('mouseup', stopDrag);
            window.addEventListener('touchend', stopDrag);
        }

        function scheduleFrame() {
            if (_rafId) return;
            _rafId = requestAnimationFrame(function() {
                _rafId = 0;
                if (isDragging && draggedEl && _latestPos) runDragFrame(_latestPos);
            });
        }

        function findBagByContainerId(cid) {
            for (var i = 0; i < bags.length; i++) if (bags[i].getContainerId() === cid) return bags[i];
            return null;
        }

        /* 多次使用物合并的本地预测（半瓶并一瓶）：同种、满容量相同、目标未满。最终以 Unity 判定为准 */
        function canMergePreview(drag, target) {
            var dr = drag._raw || {}, tr = target._raw || {};
            var dc = dr.configId || dr.itemConfigId, tc = tr.configId || tr.itemConfigId;
            if (!dc || dc !== tc) return false;
            if (!(drag.useTimesMax > 1) || drag.useTimesMax !== target.useTimesMax) return false;
            if (!!dr.polluted !== !!tr.polluted) return false;
            return target.useTimes < target.useTimesMax;
        }

        /* 落点被占时的本地预测：返回 null = 不启用（容器开关未知 / 外部来源），否则返回规划结果（kind: merge/swap/push/place/reject） */
        function planSmartDrop(bag, coord, cursor) {
            // callbacks.smartDrop === false：本面板不做交换 / 合并 / 挤开，落点被占按普通回弹
            if (callbacks.smartDrop === false) return null;
            if (!draggedItemData || draggedItemData._external) return null;
            var srcBag = findBagByContainerId(draggedItemData.containerId);
            if (!srcBag) return null;
            var pt = getDropPolicy(bag.getOwnerId());
            var pf = srcBag === bag ? pt : getDropPolicy(srcBag.getOwnerId());
            if (!pt || !pf) return null;
            var cfg = bag.getConfig();
            var items = bag.getPlanItems(draggedItemData.id);
            var allowSwap = pt.swap && pf.swap;
            var allowPush = pt.push && pf.push && !(draggedItemData._raw && draggedItemData._raw.polluted);
            var cursorItem = null;
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                if (cursor.col >= it.x && cursor.col < it.x + it.w && cursor.row >= it.y && cursor.row < it.y + it.h) { cursorItem = it; break; }
            }
            if (cursorItem && allowSwap && canMergePreview(draggedItemData, cursorItem.ref)) {
                return { kind: 'merge', targetId: cursorItem.id, moves: [] };
            }
            var plan = planBagDrop(cfg.cols, cfg.rows, items, draggedItemData.w, draggedItemData.h,
                coord.col, coord.row, cursor.col, cursor.row, allowSwap, allowPush, SMART_MAX_PUSH);
            // 跨容器交换：被换出的那件要进拖动物品的来源容器，同样过面板准入（如锅只收食材）
            if (plan.kind === 'swap' && srcBag !== bag && callbacks.canAcceptItem && cursorItem
                && !callbacks.canAcceptItem(srcBag, cursorItem.ref, false)) {
                plan = { kind: 'reject', targetId: null, moves: [], reason: 'swap back rejected' };
            }
            return plan;
        }

        function runHover(pos) {
            for (var i = 0; i < bags.length; i++) {
                var bag = bags[i];
                var rect = _bagRects ? _bagRects[i] : null;
                if (bag.isMouseOver(pos.x, pos.y, rect)) {
                    var coord = bag.getGridCoordinates(pos.x, pos.y, draggedItemData.w, draggedItemData.h, rect, _dragZoom);
                    var slots = bag.getOccupiedSlots(coord.row, coord.col, draggedItemData.w, draggedItemData.h);
                    var valid = bag.checkValidity(slots, draggedItemData.id);
                    var accept = !callbacks.canAcceptItem || callbacks.canAcceptItem(bag, draggedItemData, false);
                    var pushIds = null;
                    if (!valid && accept) {
                        var plan = planSmartDrop(bag, coord, bag.getCursorCell(pos.x, pos.y, rect, _dragZoom));
                        if (plan && (plan.kind === 'merge' || plan.kind === 'swap')) {
                            valid = true;
                        } else if (plan && plan.kind === 'push') {
                            valid = 'smart';
                            pushIds = [];
                            for (var m = 0; m < plan.moves.length; m++) pushIds.push(plan.moves[m].id);
                        }
                    } else if (valid && !accept) {
                        valid = false;
                    }
                    bag.markPushItems(pushIds);
                    bag.highlightSlots(slots, valid);
                } else {
                    bag.markPushItems(null);
                    bag.clearHighlights();
                }
            }
            _hoverDirty = false;
        }

        function runDragFrame(pos) {
            var dx = (pos.x - dragStartX) / _dragZoom;
            var dy = (pos.y - dragStartY) / _dragZoom;

            // 外部来源起拖时阈值已由调用方把过，这里不再压 5px，否则幽灵会先粘住一下才跟手
            if (!draggedItemData || !draggedItemData._external) {
                if (Math.abs(dx) <= 5 && Math.abs(dy) <= 5) return;
            }

            if (!hasDragged) {
                hasDragged = true;
                ensureSmartDropStyle();
                if (callbacks.smartDrop !== false) requestDropPolicy(bags.map(function(b) { return b.getOwnerId(); }));
                hoistDragged();
                if (callbacks.onItemPickup) callbacks.onItemPickup(draggedItemData);
            }

            draggedEl.style.left = (dragInitialLeft + dx) + 'px';
            draggedEl.style.top = (dragInitialTop + dy) + 'px';

            // 帧间逻辑位移 < 1/4 格算慢速：当帧算 hover，高亮实时跟手；快速只标脏，停稳 100ms 或松手再补算
            // 起拖后第一帧没有上一帧可比，按慢速处理，高亮立即出现
            var prev = _prevFramePos;
            _prevFramePos = pos;
            var slow = !prev ||
                (Math.abs(pos.x - prev.x) / _dragZoom < _hoverIdleThreshold &&
                 Math.abs(pos.y - prev.y) / _dragZoom < _hoverIdleThreshold);
            if (slow) {
                if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
                runHover(pos);
                return;
            }

            _hoverDirty = true;
            if (_idleTimer) clearTimeout(_idleTimer);
            _idleTimer = setTimeout(function() {
                _idleTimer = null;
                if (isDragging && draggedEl && _latestPos) runHover(_latestPos);
            }, HOVER_IDLE_DELAY);
        }

        /* 等 Unity 刷新：刷新会重绘整格、自然带走这个半透明的元素；到时还在说明没刷新（被拒且数据未变），自己回原位 */
        var PENDING_TIMEOUT_MS = 700;
        function watchPendingDrop(el, itemData, srcBag) {
            var ox = itemData.x, oy = itemData.y;
            setTimeout(function() {
                if (!el.isConnected || !el.classList.contains('smart-pending')) return;
                el.classList.remove('smart-pending');
                if (!srcBag) { el.remove(); return; }
                var c = document.getElementById(srcBag.getContainerId());
                if (c && el.parentNode !== c) c.appendChild(el);
                var oc = srcBag.getConfig();
                el.style.position = 'absolute';
                el.style.left = (oc.padding + ox * (oc.slotSize + oc.gap)) + 'px';
                el.style.top = (oc.padding + oy * (oc.slotSize + oc.gap)) + 'px';
            }, PENDING_TIMEOUT_MS);
        }

        function hoistDragged() {
            if (!draggedEl || isHoisted) return;
            var rect = draggedEl.getBoundingClientRect();
            document.body.appendChild(draggedEl);
            draggedEl.style.position = 'fixed';
            draggedEl.style.left = (rect.left / _dragZoom) + 'px';
            draggedEl.style.top = (rect.top / _dragZoom) + 'px';
            draggedEl.style.zIndex = 9999;
            dragInitialLeft = rect.left / _dragZoom;
            dragInitialTop = rect.top / _dragZoom;
            isHoisted = true;
        }


        function stopDrag(e) {
            if (!isDragging) return;
            if (e && e.button !== undefined && e.button !== 0) return;

            window.removeEventListener('mouseup', stopDrag);
            window.removeEventListener('touchend', stopDrag);

            if (_rafId) { cancelAnimationFrame(_rafId); _rafId = 0; }
            if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
            _latestPos = null;
            _bagRects = null;
            _hoverDirty = false;
            _prevFramePos = null;
            bags.forEach(function(bag) { bag._endDragCache(); });

            // 外部来源的拖拽：只判落点、只回调，不碰任何一个 bag 的数据
            if (draggedItemData && draggedItemData._external) {
                var exPos = getChangedClientXY(e);
                var exBag = null, exCoord = null;
                for (var x = 0; x < bags.length; x++) {
                    if (bags[x].isMouseOver(exPos.x, exPos.y)) { exBag = bags[x]; break; }
                }
                if (exBag) {
                    exCoord = exBag.getGridCoordinates(exPos.x, exPos.y, draggedItemData.w, draggedItemData.h, null, _dragZoom);
                    var exSlots = exBag.getOccupiedSlots(exCoord.row, exCoord.col, draggedItemData.w, draggedItemData.h);
                    var exOk = exBag.checkValidity(exSlots, draggedItemData.id);
                    if (exOk && callbacks.canAcceptItem) exOk = callbacks.canAcceptItem(exBag, draggedItemData, true);
                    if (!exOk) exCoord = null;   // 松手那一格放不下 = 这次不接，调用方按落空处理
                }
                var exPayload = draggedItemData._payload;
                if (draggedEl) draggedEl.remove();
                bags.forEach(function(bag) { bag.clearHighlights(); });
                isDragging = false;
                draggedItemData = null;
                draggedEl = null;
                bags.forEach(function(bag) { bag._flushPendingRefresh(); });
                if (callbacks.onExternalDrop) {
                    callbacks.onExternalDrop(exPayload, exBag && exCoord ? { bag: exBag, x: exCoord.col, y: exCoord.row } : null);
                }
                if (callbacks.onDragFinished) callbacks.onDragFinished();
                return;
            }

            if (!hasDragged) {
                if (draggedEl) {
                    draggedEl.style.zIndex = 10;
                    draggedEl.removeAttribute('data-no-sync');
                }
                isDragging = false;
                draggedItemData = null;
                draggedEl = null;
                bags.forEach(function(bag) { bag._flushPendingRefresh(); });
                if (callbacks.onDragFinished) callbacks.onDragFinished();
                return;
            }

            var pos = getChangedClientXY(e);
            var targetBag = null;

            for (var i = 0; i < bags.length; i++) {
                if (bags[i].isMouseOver(pos.x, pos.y)) {
                    targetBag = bags[i];
                    break;
                }
            }

            var moveSuccess = false;

            if (targetBag && draggedItemData) {
                var coord = targetBag.getGridCoordinates(pos.x, pos.y, draggedItemData.w, draggedItemData.h, null, _dragZoom);
                var slots = targetBag.getOccupiedSlots(coord.row, coord.col, draggedItemData.w, draggedItemData.h);

                var canAccept = targetBag.checkValidity(slots, draggedItemData.id);
                var smartPlan = null;
                if (!canAccept && (!callbacks.canAcceptItem || callbacks.canAcceptItem(targetBag, draggedItemData, false))) {
                    var cursorCell = targetBag.getCursorCell(pos.x, pos.y, null, _dragZoom);
                    smartPlan = planSmartDrop(targetBag, coord, cursorCell);
                    if (smartPlan && (smartPlan.kind === 'merge' || smartPlan.kind === 'swap' || smartPlan.kind === 'push')) {
                        smartPlan.cursor = cursorCell;
                    } else {
                        smartPlan = null;
                    }
                }
                if (smartPlan && callbacks.canAcceptItem && !callbacks.canAcceptItem(targetBag, draggedItemData, true)) {
                    smartPlan = null;
                }
                if (canAccept && callbacks.canAcceptItem) {
                    canAccept = callbacks.canAcceptItem(targetBag, draggedItemData, true);
                }
                if (smartPlan) {
                    /* 落点被占、本地预测可交换 / 合并 / 挤开：交给 Unity 判定，不做乐观摆放、不走回弹提示。
                       物品半透明停在落点等刷新；超时没刷新（被拒且数据未变）就自己回到原位 */
                    if (smartPlan.kind === 'merge') {
                        /* 合并只认光标格上的那件，落点用不上；但大件贴边松手按中心算出的落点会出界，BagDropRouter.TryRoute
                           对出界坐标不走拖放规则，合不上时物品会被挪去别处。夹回界内（最多挪半件，光标格仍在落点里） */
                        var mCfg = targetBag.getConfig();
                        coord = {
                            col: Math.max(0, Math.min(coord.col, mCfg.cols - draggedItemData.w)),
                            row: Math.max(0, Math.min(coord.row, mCfg.rows - draggedItemData.h))
                        };
                    }
                    var sBag = findBagByContainerId(draggedItemData.containerId);
                    if (callbacks.onItemMove) {
                        callbacks.onItemMove({
                            itemId: parseInt(draggedItemData.id),
                            fromOwnerId: sBag ? sBag.getOwnerId() : 0,
                            toOwnerId: targetBag.getOwnerId(),
                            x: coord.col,
                            y: coord.row,
                            smart: true,
                            cursorCol: smartPlan.cursor.col,
                            cursorRow: smartPlan.cursor.row
                        });
                    }
                    var flashIds = [];
                    if (smartPlan.targetId != null && smartPlan.kind === 'swap') flashIds.push(smartPlan.targetId);
                    for (var fm = 0; fm < smartPlan.moves.length; fm++) flashIds.push(smartPlan.moves[fm].id);
                    markFlash(flashIds);
                    targetBag.markPushItems(null);
                    if (draggedEl) {
                        var pCfg = targetBag.getConfig();
                        if (isHoisted || draggedItemData.containerId !== targetBag.getContainerId()) {
                            document.getElementById(targetBag.getContainerId()).appendChild(draggedEl);
                        }
                        draggedEl.style.position = 'absolute';
                        draggedEl.style.left = (pCfg.padding + coord.col * (pCfg.slotSize + pCfg.gap)) + 'px';
                        draggedEl.style.top = (pCfg.padding + coord.row * (pCfg.slotSize + pCfg.gap)) + 'px';
                        draggedEl.classList.add('smart-pending');
                        watchPendingDrop(draggedEl, draggedItemData, sBag);
                    }
                    moveSuccess = true;
                } else if (canAccept) {
                    var sourceBag = null;
                    for (var j = 0; j < bags.length; j++) {
                        if (bags[j].getContainerId() === draggedItemData.containerId) {
                            sourceBag = bags[j];
                            break;
                        }
                    }

                    var fromOwnerId = sourceBag ? sourceBag.getOwnerId() : 0;
                    var toOwnerId = targetBag.getOwnerId();
                    var isCrossContainer = draggedItemData.containerId !== targetBag.getContainerId();

                    if (callbacks.onItemMove) {
                        callbacks.onItemMove({
                            itemId: parseInt(draggedItemData.id),
                            fromOwnerId: fromOwnerId,
                            toOwnerId: toOwnerId,
                            x: coord.col,
                            y: coord.row
                        });
                    }

                    targetBag.updateItemPosition(draggedItemData.id, targetBag.getContainerId(), coord.col, coord.row);
                    if (isCrossContainer && sourceBag) {
                        sourceBag.removeItem(draggedItemData.id);
                        targetBag.getItems().push(draggedItemData);
                        draggedItemData.containerId = targetBag.getContainerId();
                        draggedItemData.x = coord.col;
                        draggedItemData.y = coord.row;
                    }

                    var targetCfg = targetBag.getConfig();
                    var newLeft = targetCfg.padding + (coord.col * (targetCfg.slotSize + targetCfg.gap));
                    var newTop = targetCfg.padding + (coord.row * (targetCfg.slotSize + targetCfg.gap));
                    if (draggedEl) {
                        if (isHoisted || isCrossContainer) {
                            document.getElementById(targetBag.getContainerId()).appendChild(draggedEl);
                        }
                        draggedEl.style.position = 'absolute';
                        draggedEl.style.left = newLeft + 'px';
                        draggedEl.style.top = newTop + 'px';
                    }
                    moveSuccess = true;
                }
            }

            if (!moveSuccess && draggedEl && draggedItemData) {
                var srcBag = null;
                for (var k = 0; k < bags.length; k++) {
                    if (bags[k].getContainerId() === draggedItemData.containerId) {
                        srcBag = bags[k];
                        break;
                    }
                }

                if (!targetBag) {
                    var interceptResult = dropInterceptor
                        ? dropInterceptor(draggedItemData, pos.x, pos.y) : false;

                    if (interceptResult === true) {
                        draggedEl.remove();
                        if (srcBag) srcBag.removeItem(draggedItemData.id);
                    } else if (interceptResult === 'reject') {
                        if (callbacks.onItemPutback) callbacks.onItemPutback(draggedItemData);
                        if (srcBag) {
                            if (isHoisted) {
                                document.getElementById(srcBag.getContainerId()).appendChild(draggedEl);
                            }
                            draggedEl.style.position = 'absolute';
                            var rCfg = srcBag.getConfig();
                            draggedEl.style.left = (rCfg.padding + draggedItemData.x * (rCfg.slotSize + rCfg.gap)) + 'px';
                            draggedEl.style.top = (rCfg.padding + draggedItemData.y * (rCfg.slotSize + rCfg.gap)) + 'px';
                        }
                    } else {
                        var srcOwnerId = srcBag ? srcBag.getOwnerId() : 0;
                        if (callbacks.onItemMove) {
                            callbacks.onItemMove({
                                itemId: parseInt(draggedItemData.id),
                                fromOwnerId: srcOwnerId,
                                toOwnerId: 0,
                                x: 0,
                                y: 0
                            });
                        }
                        draggedEl.remove();
                        if (srcBag) srcBag.removeItem(draggedItemData.id);
                    }
                } else {
                    if (callbacks.onItemPutback) callbacks.onItemPutback(draggedItemData);
                    if (srcBag) {
                        if (isHoisted) {
                            document.getElementById(srcBag.getContainerId()).appendChild(draggedEl);
                        }
                        draggedEl.style.position = 'absolute';
                        var origCfg = srcBag.getConfig();
                        draggedEl.style.left = (origCfg.padding + draggedItemData.x * (origCfg.slotSize + origCfg.gap)) + 'px';
                        draggedEl.style.top = (origCfg.padding + draggedItemData.y * (origCfg.slotSize + origCfg.gap)) + 'px';
                    }
                }
            }

            bags.forEach(function(bag) { bag.clearHighlights(); bag.markPushItems(null); });

            if (draggedEl) {
                draggedEl.style.zIndex = 10;
                draggedEl.removeAttribute('data-no-sync');
            }
            isDragging = false;
            draggedItemData = null;
            draggedEl = null;

            bags.forEach(function(bag) { bag._flushPendingRefresh(); });
            if (callbacks.onDragFinished) callbacks.onDragFinished();
        }

        function onGlobalMouseMove(e) {
            if (!isDragging || !draggedEl) return;
            var pos = getClientXY(e);
            _latestPos = pos;
            if (Math.abs(pos.x - dragStartX) / _dragZoom > 5 || Math.abs(pos.y - dragStartY) / _dragZoom > 5) {
                e.preventDefault();
            }
            scheduleFrame();
        }
        function onGlobalTouchMove(e) {
            if (!isDragging || !draggedEl) return;
            var pos = getClientXY(e);
            _latestPos = pos;
            if (Math.abs(pos.x - dragStartX) / _dragZoom > 5 || Math.abs(pos.y - dragStartY) / _dragZoom > 5) {
                e.preventDefault();
            }
            scheduleFrame();
        }

        window.addEventListener('mousemove', onGlobalMouseMove);
        window.addEventListener('touchmove', onGlobalTouchMove, { passive: false });

        return {
            isDragging: function() { return isDragging; },
            getDraggedItem: function() { return draggedItemData; },
            setDropInterceptor: function(fn) { dropInterceptor = fn; },
            /** 从格子背包之外的地方起拖；落点结果走 callbacks.onExternalDrop(payload, drop) */
            beginExternalDrag: beginExternalDrag,
            cancelDrag: function(removeItem) {
                if (!isDragging) return;
                window.removeEventListener('mouseup', stopDrag);
                window.removeEventListener('touchend', stopDrag);
                if (_rafId) { cancelAnimationFrame(_rafId); _rafId = 0; }
                if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
                _latestPos = null;
                _bagRects = null;
                _hoverDirty = false;
                _prevFramePos = null;
                bags.forEach(function(bag) { bag.clearHighlights(); bag.markPushItems(null); bag._endDragCache(); });
                if (removeItem && draggedEl && draggedItemData) {
                    draggedEl.remove();
                    for (var i = 0; i < bags.length; i++) {
                        if (bags[i].getContainerId() === draggedItemData.containerId) {
                            bags[i].removeItem(draggedItemData.id); break;
                        }
                    }
                } else if (draggedEl && draggedItemData) {
                    for (var i = 0; i < bags.length; i++) {
                        if (bags[i].getContainerId() === draggedItemData.containerId) {
                            if (isHoisted) {
                                document.getElementById(bags[i].getContainerId()).appendChild(draggedEl);
                            }
                            draggedEl.style.position = 'absolute';
                            var cfg = bags[i].getConfig();
                            draggedEl.style.left = (cfg.padding + draggedItemData.x * (cfg.slotSize + cfg.gap)) + 'px';
                            draggedEl.style.top = (cfg.padding + draggedItemData.y * (cfg.slotSize + cfg.gap)) + 'px';
                            break;
                        }
                    }
                }
                if (draggedEl) {
                    draggedEl.style.zIndex = 10;
                    draggedEl.removeAttribute('data-no-sync');
                }
                isDragging = false;
                draggedItemData = null;
                draggedEl = null;
                bags.forEach(function(bag) { bag._flushPendingRefresh(); });
                if (callbacks.onDragFinished) callbacks.onDragFinished();
            },
            destroy: function() {
                window.removeEventListener('mousemove', onGlobalMouseMove);
                window.removeEventListener('touchmove', onGlobalTouchMove);
                window.removeEventListener('mouseup', stopDrag);
                window.removeEventListener('touchend', stopDrag);
            }
        };
    }

    function createGridSizeLock(containerId) {
        var seenCols = 0, seenRows = 0, lockedW = 0, lockedH = 0;

        function step(el, axis) {
            var tpl = axis === 'x' ? el.style.gridTemplateColumns : el.style.gridTemplateRows;
            var comma = (tpl || '').indexOf(',');
            if (comma < 0) return 0;
            var size = parseFloat(tpl.slice(comma + 1));
            if (!(size > 0)) return 0;
            var cs = window.getComputedStyle(el);
            var gap = parseFloat(axis === 'x' ? cs.columnGap : cs.rowGap) || 0;
            return size + gap;
        }

        return {
            apply: function (o) {
                var el = document.getElementById(containerId);
                if (!el || !o) return;
                var cols = o.cols > 0 ? o.cols : 0;
                var rows = o.rows > 0 ? o.rows : 0;
                if (!cols || !rows) return;
                var hintC = o.maxCols > 0 ? o.maxCols : 0;
                var hintR = o.maxRows > 0 ? o.maxRows : 0;
                seenCols = hintC ? Math.max(hintC, cols) : Math.max(seenCols, cols);
                seenRows = hintR ? Math.max(hintR, rows) : Math.max(seenRows, rows);

                el.style.marginLeft = '0px';
                el.style.marginRight = '0px';
                el.style.marginTop = '0px';
                el.style.marginBottom = '0px';
                var baseW = el.offsetWidth, baseH = el.offsetHeight;

                var diffX = Math.round(Math.max(0, seenCols - cols) * step(el, 'x'));
                var padL = Math.floor(diffX / 2), padR = diffX - padL;
                var padT = Math.round(Math.max(0, o.extraTop || 0));
                var padB = Math.round(Math.max(0, seenRows - rows) * step(el, 'y'));
                el.style.marginLeft = padL + 'px';
                el.style.marginRight = padR + 'px';
                el.style.marginTop = padT + 'px';
                el.style.marginBottom = padB + 'px';
                lockedW = baseW + diffX;
                lockedH = baseH + padT + padB;
            },
            width: function () { return lockedW; },
            height: function () { return lockedH; }
        };
    }

    function createViewportFit(opts) {
        var cfg = opts || {};
        var selector = cfg.measureSelector;
        var margin = cfg.margin === undefined ? 48 : cfg.margin;
        var heightProp = cfg.bodyHeightProp === undefined ? 'minHeight' : cfg.bodyHeightProp;
        var zoom = 1;

        function apply() {
            var el = selector && document.querySelector(selector);
            if (!el) return;
            document.body.style.zoom = '';
            if (heightProp) document.body.style[heightProp] = '';
            var w = el.offsetWidth, h = el.offsetHeight;
            if (!w || !h) return;
            var k = Math.min(1, (window.innerWidth - margin) / w, (window.innerHeight - margin) / h);
            zoom = k;
            if (k < 1) {
                document.body.style.zoom = k;
                if (heightProp) document.body.style[heightProp] = (window.innerHeight / k) + 'px';
            }
        }

        window.addEventListener('resize', apply);
        return { apply: apply, getZoom: function () { return zoom; } };
    }

    global.createGridBag = createGridBag;
    global.createBagDragCoordinator = createBagDragCoordinator;
    global.createViewportFit = createViewportFit;
    global.createGridSizeLock = createGridSizeLock;
    global.planBagDrop = planBagDrop;
    global.bagDropPolicy = { request: requestDropPolicy, get: getDropPolicy, maxPush: SMART_MAX_PUSH };

})(typeof window !== "undefined" ? window : globalThis);
