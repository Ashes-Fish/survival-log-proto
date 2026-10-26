/*
 * 物品飞行动画公共件 —— 东西换了个地方时，让它从原处飞到新处，而不是瞬间消失再出现。
 *
 * 首个用例是材料架点一行取出（此前内联在 MaterialRack.html），现由材料架 / 制造台材料架页签 /
 * 粉碎机小车 / 无人机中控台货架共用。
 *
 * 约束（写新用例前先读）：
 *   · 起点和终点必须在同一个面板文档里 —— 每个 WebUI 面板是独立 iframe，跨面板飞不了。
 *   · 终点要能拿到元素：格子背包里的物品节点 id 就是物品实例 id（webui-bag.js 的 renderItems），
 *     直接 document.getElementById(String(itemId))。
 *   · 到底飞哪几件由调用方判定，本模块只管画：材料架那侧只有「一行一堆」、认不出逐件 id，
 *     用刷新前后的背包 id 差集；两栏格子之间搬运则可以用同一个 id 在两侧的前后位置对账。
 *   · 动画只动 transform / opacity（webui-effects-performance.md 的强制口径）；低画质档整体跳过。
 *   · 宿主元素必须是定位元素（position:relative/absolute），飞行层按它的左上角算相对坐标。
 *
 * 用法（自己配对）：
 *   var flyer = createItemFlyer({ host: $('rackSystem'), layer: $('flyLayer'), getZoom: getZoom });
 *   flyer.run([{ id: itemId, icon: url, fromRect: 起点的视口矩形, toEl: 终点元素 }]);
 *
 * 用法（一行一堆的场景交给它配对）：搬之前记一笔，刷新回来结账
 *   flyer.pend({ configId: 这种材料, fromRects: 起点矩形们, before: flyer.snapshot(目标容器当前物品) });
 *   flyer.settle(目标容器刷新后的物品);   // 挑出「同种材料 + 此前不在」的那几件飞进去
 *   刷新格子时问一句：flyer.applyArriving(格子元素, itemId);  // 飞行途中先藏住终点，落地才显形
 *   关面板 / 切页签：flyer.clear();                          // 免得残留的隐藏态把格子藏死
 */
(function (global) {
    'use strict';

    var STYLE_ID = 'fly-items-style';
    var CSS = [
        '.fly-layer{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:60;}',
        '.fly-item{position:absolute;left:0;top:0;border-radius:5px;border:1.5px solid var(--fly-accent,#FFC107);',
        '  background:var(--fly-bg,rgba(30,26,18,.88));box-shadow:0 6px 16px rgba(0,0,0,.5);',
        '  display:flex;align-items:center;justify-content:center;transform-origin:0 0;}',
        '.fly-item img{max-width:88%;max-height:88%;object-fit:contain;}',
        /* 飞行途中的终点格子：先藏住，落地那一刻才显形 */
        '.fly-arriving{opacity:0;}'
    ].join('\n');

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

    /**
     * @param opts {
     *   host      定位基准元素（必须是定位元素）
     *   layer     飞行层元素；不给就自动在 host 里建一个
     *   getZoom   取当前页面缩放的函数（createViewportFit 的 getZoom）；不给按 1
     *   max       一次最多飞几件，默认 12（再多也看不清，只是白烧 GPU）
     *   duration  单件时长，默认 340ms
     *   stagger   相邻两件的错峰间隔，默认 24ms
     * }
     */
    function createItemFlyer(opts) {
        ensureStyle();
        var o = { max: 12, duration: 340, stagger: 24 };
        for (var k in (opts || {})) o[k] = opts[k];

        var arriving = {};

        function layerEl() {
            if (o.layer) return o.layer;
            if (!o.host) return null;
            var made = document.createElement('div');
            made.className = 'fly-layer';
            made.setAttribute('data-no-sync', '');
            o.host.appendChild(made);
            o.layer = made;
            return made;
        }

        function zoom() {
            var z = typeof o.getZoom === 'function' ? o.getZoom() : 1;
            return z || 1;
        }

        function release(id, el) {
            delete arriving[String(id)];
            var cur = el && el.isConnected ? el : document.getElementById(String(id));
            if (cur) cur.classList.remove('fly-arriving');
        }

        var pending = null;

        /**
         * 飞一批。pairs = [{ id, icon, fromRect（视口矩形，getBoundingClientRect 的结果）, toEl }]
         * fromRect 要在数据刷新**之前**量好——刷新后源头那张卡片就没了。
         */
        function doRun(pairs) {
                if (!pairs || !pairs.length || !o.host || isLowQuality()) return;
                var layer = layerEl();
                if (!layer) return;
                var hostRect = o.host.getBoundingClientRect(), z = zoom();
                var n = Math.min(pairs.length, o.max);
                for (var i = 0; i < n; i++) {
                    (function (p, delay) {
                        if (!p || !p.toEl || !p.fromRect) return;
                        var fr = p.fromRect, tr = p.toEl.getBoundingClientRect();
                        if (!fr.width || !tr.width) return;
                        var from = { x: (fr.left - hostRect.left) / z, y: (fr.top - hostRect.top) / z, w: fr.width / z, h: fr.height / z };
                        var to = { x: (tr.left - hostRect.left) / z, y: (tr.top - hostRect.top) / z, w: tr.width / z, h: tr.height / z };

                        arriving[String(p.id)] = true;
                        p.toEl.classList.add('fly-arriving');

                        var f = document.createElement('div');
                        f.className = 'fly-item';
                        f.style.width = from.w + 'px';
                        f.style.height = from.h + 'px';
                        var img = document.createElement('img');
                        img.src = p.icon || '';
                        img.draggable = false;
                        f.appendChild(img);
                        layer.appendChild(f);

                        var anim = f.animate([
                            { transform: 'translate(' + from.x + 'px,' + from.y + 'px) scale(1,1)', opacity: 1 },
                            { transform: 'translate(' + to.x + 'px,' + to.y + 'px) scale(' + (to.w / from.w) + ',' + (to.h / from.h) + ')', opacity: 1 }
                        ], { duration: o.duration, delay: delay, easing: 'cubic-bezier(.25,.8,.3,1)', fill: 'both' });

                        var done = function () {
                            f.remove();
                            release(p.id, p.toEl);
                        };
                        anim.onfinish = done;
                        anim.oncancel = done;
                    })(pairs[i], i * o.stagger);
                }
        }

        return {
            run: doRun,

            /** 物品列表的 id 快照（搬之前记，用来认出刷新后哪几件是新到的） */
            snapshot: function (items) {
                var m = {};
                if (items) {
                    for (var i = 0; i < items.length; i++) {
                        var it = items[i];
                        if (it) m[String(it.itemId !== undefined ? it.itemId : it.id)] = true;
                    }
                }
                return m;
            },

            /**
             * 搬之前记一笔。opts = { configId（限定哪种材料，0 = 不限）, fromRects（起点矩形们）, before（id 快照） }
             * 没有起点矩形就不记——没有起点画不了。
             */
            pend: function (opts) {
                pending = opts && opts.fromRects && opts.fromRects.length ? opts : null;
            },

            /** 取消这一笔（比如这次搬运前端就拦下了） */
            unpend: function () { pending = null; },

            /** 有没有记在账上的 */
            hasPending: function () { return !!pending; },

            /**
             * 刷新回来结账：在新列表里挑出「同种材料 + 此前不在」的那几件，配上起点飞进去。
             * items = 目标容器刷新后的物品（要有 itemId / configId / icon）。
             */
            settle: function (items) {
                var p = pending;
                pending = null;
                if (!p || !items) return;
                var pairs = [];
                for (var i = 0; i < items.length; i++) {
                    var it = items[i];
                    if (!it) continue;
                    var id = it.itemId !== undefined ? it.itemId : it.id;
                    if (p.configId && it.configId !== p.configId) continue;
                    if (p.before && p.before[String(id)]) continue;
                    var el = document.getElementById(String(id));
                    if (!el) continue;
                    pairs.push({ id: id, icon: it.icon, fromRect: p.fromRects[Math.min(pairs.length, p.fromRects.length - 1)], toEl: el });
                }
                doRun(pairs);
            },

            /** 这件是不是正在飞（重渲染时问一句，别把还在路上的终点格子提前画出来） */
            isArriving: function (id) { return !!arriving[String(id)]; },

            /** 重渲染后给终点格子补上隐藏态；不在飞的什么都不做 */
            applyArriving: function (el, id) {
                if (el && arriving[String(id)]) el.classList.add('fly-arriving');
            },

            /** 全部收掉：动画取消、隐藏态还原（关面板 / 切页签必调，免得把格子藏死） */
            clear: function () {
                pending = null;
                var layer = o.layer;
                if (layer) layer.innerHTML = '';
                for (var id in arriving) release(id, null);
                arriving = {};
            }
        };
    }

    global.createItemFlyer = createItemFlyer;
})(window);
