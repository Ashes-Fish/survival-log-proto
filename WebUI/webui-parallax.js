(function (global) {
    'use strict';

    var PERIOD_SEC   = 26;
    var FG_AMP       = 10;
    var BG_AMP       = 40;
    var BASE_SCALE   = 1.05;
    var FG_EXTRA     = 1.00;
    var PHASE_OFFSET = 0.9;
    var Y_RATIO      = 0.35;
    var Y_FREQ       = 0.7;

    function createBgParallax(opt) {
        var bgTrack = opt.bgTrack;
        var fgTrack = opt.fgTrack;
        if (!bgTrack) return null;

        var raf = 0;
        var stopped = false;
        var t0 = 0;

        function isLowQuality() {
            return document.documentElement.classList.contains('quality-low');
        }

        function apply(ph) {
            var k = window.innerWidth / 1920;
            var bx = Math.sin(ph + PHASE_OFFSET) * BG_AMP * k;
            var by = Math.cos((ph + PHASE_OFFSET) * Y_FREQ) * BG_AMP * Y_RATIO * k;
            var fx = Math.sin(ph) * FG_AMP * k;
            var fy = Math.cos(ph * Y_FREQ) * FG_AMP * Y_RATIO * k;
            bgTrack.style.transform = 'translate3d(' + bx.toFixed(2) + 'px,' + by.toFixed(2) + 'px,0) scale(' + BASE_SCALE + ')';
            if (fgTrack) {
                fgTrack.style.transform = 'translate3d(' + fx.toFixed(2) + 'px,' + fy.toFixed(2) + 'px,0) scale(' + (BASE_SCALE * FG_EXTRA) + ')';
            }
        }

        function applyStatic() { apply(0); }

        function frame(now) {
            if (stopped) return;
            raf = requestAnimationFrame(frame);
            if (document.hidden) return;
            if (isLowQuality()) { applyStatic(); return; }
            if (!t0) t0 = now;
            apply(((now - t0) / 1000) * (Math.PI * 2 / PERIOD_SEC));
        }

        applyStatic();
        raf = requestAnimationFrame(frame);

        return {
            stop: function () { stopped = true; cancelAnimationFrame(raf); applyStatic(); },
            resume: function () { if (stopped) { stopped = false; raf = requestAnimationFrame(frame); } }
        };
    }

    var LAYERED = [
        'BackGround02',
        'BackGround_Player2',
        'BackGround_Player3',
        'BackGround_Player4',
        'BackGround_Endless_1',
        'BackGround_Endless_2',
        'BackGround_Endless_3',
        'BackGround_Endless_4'
    ];

    function baseName(src) {
        var f = String(src || '').split('/').pop();
        return f.replace(/\.(png|jpe?g|webp)$/i, '');
    }

    function parallaxLayerUrl(src, kind) {
        if (!src) return '';
        return String(src).replace(/\.(png|jpe?g|webp)$/i, '') + '_' + kind + '.webp';
    }

    function hasParallaxLayers(src) {
        return LAYERED.indexOf(baseName(src)) >= 0;
    }

    global.createBgParallax = createBgParallax;
    global.parallaxLayerUrl = parallaxLayerUrl;
    global.hasParallaxLayers = hasParallaxLayers;
})(window);
