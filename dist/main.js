// src/core/types.ts
var BACKPACK = "backpack";
var TRUNK = "trunk";
var HOME = "home";
var HAND = "hand";
var RESERVED_CONTAINERS = [BACKPACK, TRUNK, HOME, HAND];
var ROTATIONS = [0, 90, 180, 270];
var STAT_IDS = ["satiety", "health", "energy", "mood"];
var ACTIVITIES = ["idle", "work", "sleep", "travel"];

// src/data/validate.ts
var ITEM_CATEGORIES = ["food", "drink", "medicine", "material", "fuel", "seed", "junk"];
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
var Checker = class {
  errors = [];
  err(path, msg) {
    this.errors.push(`${path}: ${msg}`);
  }
  obj(v, path) {
    if (isObj(v)) return v;
    this.err(path, "\u5E94\u4E3A\u5BF9\u8C61");
    return null;
  }
  arr(v, path) {
    if (Array.isArray(v)) return v;
    this.err(path, "\u5E94\u4E3A\u6570\u7EC4");
    return null;
  }
  str(v, path) {
    if (typeof v === "string" && v.length > 0) return v;
    this.err(path, "\u5E94\u4E3A\u975E\u7A7A\u5B57\u7B26\u4E32");
    return null;
  }
  num(v, path, opt = {}) {
    if (!isNum(v)) {
      this.err(path, "\u5E94\u4E3A\u6709\u9650\u6570\u5B57");
      return null;
    }
    if (opt.int && !Number.isInteger(v)) this.err(path, `\u5E94\u4E3A\u6574\u6570,\u5B9E\u9645 ${v}`);
    if (opt.min !== void 0 && v < opt.min) this.err(path, `\u5E94 >= ${opt.min},\u5B9E\u9645 ${v}`);
    if (opt.max !== void 0 && v > opt.max) this.err(path, `\u5E94 <= ${opt.max},\u5B9E\u9645 ${v}`);
    if (opt.gt !== void 0 && v <= opt.gt) this.err(path, `\u5E94 > ${opt.gt},\u5B9E\u9645 ${v}`);
    return v;
  }
  bool(v, path) {
    if (typeof v === "boolean") return v;
    this.err(path, "\u5E94\u4E3A\u5E03\u5C14\u503C");
    return null;
  }
  /** 可选字段:undefined 通过,否则按 fn 校验。 */
  opt(v, fn) {
    if (v !== void 0) fn(v);
  }
  /** Record<id, T>:键必须等于值里的 id 字段。 */
  table(v, path, each) {
    const t = this.obj(v, path);
    if (!t) return {};
    if (Object.keys(t).length === 0) this.err(path, "\u4E0D\u80FD\u4E3A\u7A7A");
    for (const [key, item] of Object.entries(t)) {
      const p = `${path}.${key}`;
      const o = this.obj(item, p);
      if (!o) continue;
      if (o.id !== key) this.err(`${p}.id`, `\u5E94\u7B49\u4E8E\u952E\u540D "${key}",\u5B9E\u9645 ${JSON.stringify(o.id)}`);
      each(o, key, p);
    }
    return t;
  }
  /** Record<ItemId, 正整数>:键必须是已有物品。 */
  qtyMap(v, path, items, opt = {}) {
    const m = this.obj(v, path);
    if (!m) return;
    if (!opt.allowEmpty && Object.keys(m).length === 0) this.err(path, "\u4E0D\u80FD\u4E3A\u7A7A");
    for (const [k, q] of Object.entries(m)) {
      if (!(k in items)) this.err(`${path}.${k}`, `\u7269\u54C1 "${k}" \u4E0D\u5B58\u5728`);
      this.num(q, `${path}.${k}`, { int: true, min: 1 });
    }
  }
  partialStats(v, path) {
    const m = this.obj(v, path);
    if (!m) return;
    for (const [k, x] of Object.entries(m)) {
      if (!STAT_IDS.includes(k)) this.err(`${path}.${k}`, `\u672A\u77E5\u72B6\u6001 "${k}"`);
      this.num(x, `${path}.${k}`);
    }
  }
  fullStats(v, path) {
    const m = this.obj(v, path);
    if (!m) return;
    for (const s of STAT_IDS) this.num(m[s], `${path}.${s}`);
    for (const k of Object.keys(m)) if (!STAT_IDS.includes(k)) this.err(`${path}.${k}`, `\u672A\u77E5\u72B6\u6001 "${k}"`);
  }
  /** 格子尺寸 { w, h },都是正整数,不超过 30。 */
  grid(v, path) {
    const g = this.obj(v, path);
    if (!g) return;
    this.num(g.w, `${path}.w`, { int: true, min: 1, max: 30 });
    this.num(g.h, `${path}.h`, { int: true, min: 1, max: 30 });
  }
  /** 形状:非空的字符串数组,每行一样长,只含 X 和 .,至少一个 X。 */
  shape(v, path) {
    const rows = this.arr(v, path);
    if (!rows) return;
    if (rows.length === 0 || !rows.every((r) => typeof r === "string" && /^[X.]+$/.test(r))) return this.err(path, "\u6BCF\u884C\u5E94\u4E3A\u53EA\u542B X \u548C . \u7684\u975E\u7A7A\u5B57\u7B26\u4E32");
    if (new Set(rows.map((r) => r.length)).size !== 1) this.err(path, "\u6BCF\u884C\u5E94\u4E00\u6837\u957F");
    if (!rows.some((r) => r.includes("X"))) this.err(path, "\u81F3\u5C11\u8981\u6709\u4E00\u4E2A X");
  }
  range(v, path, opt = {}) {
    const a = this.arr(v, path);
    if (!a) return;
    if (a.length !== 2) return this.err(path, "\u5E94\u4E3A [min, max]");
    const lo = this.num(a[0], `${path}[0]`, { int: true, min: opt.min ?? 0 });
    const hi = this.num(a[1], `${path}[1]`, { int: true, min: opt.min ?? 0 });
    if (lo !== null && hi !== null && lo > hi) this.err(path, `min(${lo}) \u4E0D\u80FD\u5927\u4E8E max(${hi})`);
  }
};
function validateGameData(raw) {
  const c = new Checker();
  const root = c.obj(raw, "$");
  if (!root) throw new Error(c.errors.join("\n"));
  const idsOf = (v) => isObj(v) ? v : {};
  const items = idsOf(root.items);
  const effects = idsOf(root.effects);
  const facilities = idsOf(root.facilities);
  const locations = idsOf(root.locations);
  const crops = idsOf(root.crops);
  const vehicles = idsOf(root.vehicles);
  const cfgPath = "$.config";
  const cfg = c.obj(root.config, cfgPath);
  let statMax = 100;
  let targetDays = 0;
  if (cfg) {
    const n = (k, o = {}) => c.num(cfg[k], `${cfgPath}.${k}`, o);
    n("startHour", { int: true, min: 0, max: 23 });
    n("stockpileMinutes", { int: true, gt: 0 });
    targetDays = n("targetDays", { int: true, gt: 0 }) ?? 0;
    n("tickMinutes", { int: true, gt: 0 });
    statMax = n("statMax", { gt: 0 }) ?? 100;
    n("sleepDecayMult", { min: 0 });
    n("buyMinutes", { int: true, min: 0 });
    c.grid(cfg.backpackGrid, `${cfgPath}.backpackGrid`);
    c.grid(cfg.homeGrid, `${cfgPath}.homeGrid`);
    n("stackAgeFraction", { min: 0, max: 1 });
    n("plantMinutes", { int: true, min: 0 });
    n("harvestMinutes", { int: true, min: 0 });
    n("gridOutageDay", { int: true, min: 1 });
    n("nightStartHour", { int: true, min: 0, max: 23 });
    n("nightEndHour", { int: true, min: 0, max: 23 });
    n("nightDangerMult", { min: 0 });
    const ss = c.obj(cfg.startStats, `${cfgPath}.startStats`);
    c.fullStats(cfg.startStats, `${cfgPath}.startStats`);
    if (ss) {
      for (const s of STAT_IDS) if (isNum(ss[s]) && (ss[s] < 0 || ss[s] > statMax)) c.err(`${cfgPath}.startStats.${s}`, `\u5E94\u5728 [0, ${statMax}] \u5185,\u5B9E\u9645 ${ss[s]}`);
    }
    c.fullStats(cfg.baseRates, `${cfgPath}.baseRates`);
    const ae = c.obj(cfg.activityEnergy, `${cfgPath}.activityEnergy`);
    if (ae) for (const a of ACTIVITIES) c.num(ae[a], `${cfgPath}.activityEnergy.${a}`);
    for (const k of ["buyQuantities", "sleepHoursOptions", "waitMinutesOptions"]) {
      const a = c.arr(cfg[k], `${cfgPath}.${k}`);
      if (!a) continue;
      if (a.length === 0) c.err(`${cfgPath}.${k}`, "\u4E0D\u80FD\u4E3A\u7A7A");
      a.forEach((x, i) => {
        const hi = k === "sleepHoursOptions" ? 24 : k === "waitMinutesOptions" ? 1440 : void 0;
        c.num(x, `${cfgPath}.${k}[${i}]`, { int: true, min: 1, max: hi });
      });
    }
    const bands = c.arr(cfg.priceBands, `${cfgPath}.priceBands`);
    if (bands) {
      if (bands.length === 0) c.err(`${cfgPath}.priceBands`, "\u4E0D\u80FD\u4E3A\u7A7A");
      let prev = -1;
      bands.forEach((b, i) => {
        const p = `${cfgPath}.priceBands[${i}]`;
        const o = c.obj(b, p);
        if (!o) return;
        const from = c.num(o.fromMinute, `${p}.fromMinute`, { int: true, min: 0 });
        c.num(o.mult, `${p}.mult`, { gt: 0 });
        if (from !== null) {
          if (i === 0 && from !== 0) c.err(`${p}.fromMinute`, "\u9996\u9879\u5FC5\u987B\u4E3A 0");
          if (from <= prev) c.err(`${p}.fromMinute`, "\u5FC5\u987B\u4E25\u683C\u5347\u5E8F");
          prev = from;
        }
      });
    }
    const ap = c.obj(cfg.awayPenalty, `${cfgPath}.awayPenalty`);
    if (ap) {
      c.num(ap.lossFraction, `${cfgPath}.awayPenalty.lossFraction`, { min: 0, max: 1 });
      c.num(ap.healthLoss, `${cfgPath}.awayPenalty.healthLoss`, { min: 0 });
    }
    const br = c.obj(cfg.breach, `${cfgPath}.breach`);
    if (br) {
      c.num(br.damagePerPoint, `${cfgPath}.breach.damagePerPoint`, { min: 0 });
      c.num(br.lossFraction, `${cfgPath}.breach.lossFraction`, { min: 0, max: 1 });
    }
    const pt = c.obj(cfg.points, `${cfgPath}.points`);
    if (pt) {
      c.num(pt.perDay, `${cfgPath}.points.perDay`, { min: 0 });
      c.num(pt.victoryBonus, `${cfgPath}.points.victoryBonus`, { min: 0 });
    }
    for (const k of ["fuelItem", "spoiledItem"]) {
      const v = c.str(cfg[k], `${cfgPath}.${k}`);
      if (v && !(v in items)) c.err(`${cfgPath}.${k}`, `\u7269\u54C1 "${v}" \u4E0D\u5B58\u5728`);
    }
    const home2 = c.str(cfg.homeLocation, `${cfgPath}.homeLocation`);
    if (home2 && !(home2 in locations)) c.err(`${cfgPath}.homeLocation`, `\u5730\u70B9 "${home2}" \u4E0D\u5B58\u5728`);
  }
  c.table(root.items, "$.items", (o, _id, p) => {
    c.str(o.name, `${p}.name`);
    const cat = c.str(o.category, `${p}.category`);
    if (cat && !ITEM_CATEGORIES.includes(cat)) c.err(`${p}.category`, `\u672A\u77E5\u7C7B\u522B "${cat}"`);
    c.opt(o.shelfLifeMinutes, (v) => c.num(v, `${p}.shelfLifeMinutes`, { int: true, gt: 0 }));
    if (o.size !== void 0) c.err(`${p}.size`, "\u5DF2\u5E9F\u5F03:\u6539\u7528 shape(\u5F62\u72B6)\u548C stack(\u53E0\u653E\u4E0A\u9650)");
    c.opt(o.shape, (v) => c.shape(v, `${p}.shape`));
    c.opt(o.stack, (v) => c.num(v, `${p}.stack`, { int: true, min: 1 }));
    c.opt(o.glyph, (v) => {
      if (typeof v !== "string" || v.length < 1 || v.length > 2) c.err(`${p}.glyph`, "\u5E94\u4E3A 1~2 \u4E2A\u5B57");
    });
    c.opt(o.use, (v) => {
      const u = c.obj(v, `${p}.use`);
      if (!u) return;
      c.num(u.minutes, `${p}.use.minutes`, { int: true, min: 0 });
      c.opt(u.stats, (s) => c.partialStats(s, `${p}.use.stats`));
      for (const k of ["applyEffects", "removeEffects"]) {
        c.opt(u[k], (list2) => {
          const a = c.arr(list2, `${p}.use.${k}`);
          a?.forEach((id, i) => {
            if (typeof id !== "string" || !(id in effects)) c.err(`${p}.use.${k}[${i}]`, `\u6548\u679C "${String(id)}" \u4E0D\u5B58\u5728`);
            else if (k === "applyEffects" && effects[id].durationMinutes === void 0) c.err(`${p}.use.${k}[${i}]`, `\u6548\u679C "${id}" \u662F\u9608\u503C\u6548\u679C,\u4E0D\u80FD\u7531\u7269\u54C1\u65BD\u52A0`);
          });
        });
      }
    });
  });
  c.table(root.effects, "$.effects", (o, _id, p) => {
    c.str(o.name, `${p}.name`);
    if (typeof o.description !== "string") c.err(`${p}.description`, "\u5E94\u4E3A\u5B57\u7B26\u4E32");
    const hasWhen = o.when !== void 0;
    const hasDur = o.durationMinutes !== void 0;
    if (hasWhen === hasDur) c.err(p, "\u5FC5\u987B\u5728 when \u4E0E durationMinutes \u4E2D\u4E8C\u9009\u4E00");
    if (hasWhen) {
      const w = c.arr(o.when, `${p}.when`);
      if (w && w.length === 0) c.err(`${p}.when`, "\u4E0D\u80FD\u4E3A\u7A7A\u6570\u7EC4");
      w?.forEach((cond, i) => {
        const cp = `${p}.when[${i}]`;
        const co = c.obj(cond, cp);
        if (!co) return;
        if (!STAT_IDS.includes(co.stat)) c.err(`${cp}.stat`, `\u672A\u77E5\u72B6\u6001 ${JSON.stringify(co.stat)}`);
        if (co.op !== "<" && co.op !== ">") c.err(`${cp}.op`, `\u5E94\u4E3A "<" \u6216 ">"`);
        c.num(co.value, `${cp}.value`);
      });
    }
    if (hasDur) c.num(o.durationMinutes, `${p}.durationMinutes`, { int: true, gt: 0 });
    c.partialStats(o.perMinute, `${p}.perMinute`);
    c.opt(o.actionTimeMult, (v) => c.num(v, `${p}.actionTimeMult`, { gt: 0 }));
    c.opt(o.deathCause, (v) => c.str(v, `${p}.deathCause`));
  });
  const weather = c.table(root.weather, "$.weather", (o, _id, p) => {
    c.str(o.name, `${p}.name`);
    c.num(o.weight, `${p}.weight`, { gt: 0 });
    c.num(o.minDay, `${p}.minDay`, { int: true, min: 1 });
    c.opt(o.perMinute, (v) => c.partialStats(v, `${p}.perMinute`));
    c.opt(o.blocksScavenge, (v) => c.bool(v, `${p}.blocksScavenge`));
    c.opt(o.blackout, (v) => c.bool(v, `${p}.blackout`));
  });
  if (!Object.values(weather).some((w) => isObj(w) && isNum(w.minDay) && w.minDay <= 1)) c.err("$.weather", "\u81F3\u5C11\u8981\u6709\u4E00\u79CD minDay <= 1 \u7684\u5929\u6C14");
  c.table(root.facilities, "$.facilities", (o, id, p) => {
    if (RESERVED_CONTAINERS.includes(id)) c.err(p, `"${id}" \u662F\u5185\u7F6E\u5BB9\u5668\u7684\u540D\u5B57,\u8BBE\u65BD\u4E0D\u80FD\u7528`);
    c.str(o.name, `${p}.name`);
    if (typeof o.description !== "string") c.err(`${p}.description`, "\u5E94\u4E3A\u5B57\u7B26\u4E32");
    const lv = c.arr(o.levels, `${p}.levels`);
    if (lv && lv.length === 0) c.err(`${p}.levels`, "\u81F3\u5C11 1 \u7EA7");
    lv?.forEach((l, i) => {
      const lp = `${p}.levels[${i}]`;
      const lo = c.obj(l, lp);
      if (!lo) return;
      c.qtyMap(lo.cost, `${lp}.cost`, items, { allowEmpty: true });
      c.num(lo.buildMinutes, `${lp}.buildMinutes`, { int: true, min: 0 });
      c.opt(lo.defense, (v) => c.num(v, `${lp}.defense`, { min: 0 }));
      c.opt(lo.cropSlots, (v) => c.num(v, `${lp}.cropSlots`, { int: true, min: 0 }));
      if (lo.spoilMult !== void 0) c.err(`${lp}.spoilMult`, "\u5DF2\u5E9F\u5F03:\u4FDD\u9C9C\u6539\u4E3A storage.spoilMult,\u53EA\u4F5C\u7528\u4E8E\u653E\u5728\u91CC\u9762\u7684\u7269\u54C1");
      c.opt(lo.storage, (v) => {
        const sp = `${lp}.storage`;
        const so = c.obj(v, sp);
        if (!so) return;
        if (so.capacity !== void 0) c.err(`${sp}.capacity`, "\u5DF2\u5E9F\u5F03:\u6539\u7528 grid");
        c.grid(so.grid, `${sp}.grid`);
        c.opt(so.spoilMult, (x) => c.num(x, `${sp}.spoilMult`, { gt: 0, max: 1 }));
        c.opt(so.needsPower, (x) => c.bool(x, `${sp}.needsPower`));
        c.opt(so.breachLossMult, (x) => c.num(x, `${sp}.breachLossMult`, { min: 0, max: 1 }));
        c.opt(so.autoFill, (x) => c.bool(x, `${sp}.autoFill`));
        c.opt(so.accepts, (x) => {
          const a = c.arr(x, `${sp}.accepts`);
          if (a && a.length === 0) c.err(`${sp}.accepts`, "\u4E0D\u80FD\u4E3A\u7A7A\u6570\u7EC4(\u8981\u63A5\u53D7\u5168\u90E8\u7C7B\u522B\u5C31\u7701\u7565\u8FD9\u4E2A\u5B57\u6BB5)");
          a?.forEach((cat, k) => {
            if (typeof cat !== "string" || !ITEM_CATEGORIES.includes(cat)) c.err(`${sp}.accepts[${k}]`, `\u672A\u77E5\u7C7B\u522B ${JSON.stringify(cat)}`);
          });
        });
      });
      c.opt(lo.needsPower, (v) => c.bool(v, `${lp}.needsPower`));
      c.opt(lo.providesPower, (v) => c.bool(v, `${lp}.providesPower`));
      c.opt(lo.fuelPerHour, (v) => c.num(v, `${lp}.fuelPerHour`, { min: 0 }));
      if (lo.providesPower === true && !isNum(lo.fuelPerHour)) c.err(`${lp}.fuelPerHour`, "providesPower \u7684\u7B49\u7EA7\u5FC5\u987B\u7ED9\u51FA fuelPerHour");
    });
  });
  c.table(root.recipes, "$.recipes", (o, _id, p) => {
    c.str(o.name, `${p}.name`);
    c.qtyMap(o.inputs, `${p}.inputs`, items);
    c.qtyMap(o.outputs, `${p}.outputs`, items);
    c.num(o.minutes, `${p}.minutes`, { int: true, min: 1 });
    c.opt(o.requiresFacility, (v) => {
      if (typeof v !== "string" || !(v in facilities)) c.err(`${p}.requiresFacility`, `\u8BBE\u65BD "${String(v)}" \u4E0D\u5B58\u5728`);
    });
  });
  c.table(root.crops, "$.crops", (o, _id, p) => {
    c.str(o.name, `${p}.name`);
    const seed = c.str(o.seedItem, `${p}.seedItem`);
    if (seed && !(seed in items)) c.err(`${p}.seedItem`, `\u7269\u54C1 "${seed}" \u4E0D\u5B58\u5728`);
    c.num(o.growMinutes, `${p}.growMinutes`, { int: true, gt: 0 });
    c.qtyMap(o.yield, `${p}.yield`, items);
  });
  const home = isObj(root.config) && typeof root.config.homeLocation === "string" ? root.config.homeLocation : null;
  c.table(root.locations, "$.locations", (o, id, p) => {
    c.str(o.name, `${p}.name`);
    const tm = c.obj(o.travelMinutes, `${p}.travelMinutes`);
    if (tm) {
      for (const [to, m] of Object.entries(tm)) {
        if (!(to in locations)) c.err(`${p}.travelMinutes.${to}`, `\u5730\u70B9 "${to}" \u4E0D\u5B58\u5728`);
        if (to === id) c.err(`${p}.travelMinutes.${to}`, "\u4E0D\u80FD\u6307\u5411\u81EA\u5DF1");
        c.num(m, `${p}.travelMinutes.${to}`, { int: true, gt: 0 });
      }
    }
    c.opt(o.stock, (v) => {
      const s = c.arr(v, `${p}.stock`);
      const seen = /* @__PURE__ */ new Set();
      s?.forEach((e, i) => {
        const sp = `${p}.stock[${i}]`;
        const so = c.obj(e, sp);
        if (!so) return;
        const it = c.str(so.item, `${sp}.item`);
        if (it) {
          if (!(it in items)) c.err(`${sp}.item`, `\u7269\u54C1 "${it}" \u4E0D\u5B58\u5728`);
          if (seen.has(it)) c.err(`${sp}.item`, `\u91CD\u590D\u7684\u5546\u54C1 "${it}"`);
          seen.add(it);
        }
        c.num(so.price, `${sp}.price`, { int: true, min: 1 });
        c.num(so.qty, `${sp}.qty`, { int: true, min: 1 });
      });
    });
    c.opt(o.vehicles, (v) => {
      const a = c.arr(v, `${p}.vehicles`);
      a?.forEach((vid, i) => {
        if (typeof vid !== "string" || !(vid in vehicles)) c.err(`${p}.vehicles[${i}]`, `\u8F66\u8F86 "${String(vid)}" \u4E0D\u5B58\u5728`);
      });
      if (a && new Set(a).size !== a.length) c.err(`${p}.vehicles`, "\u6709\u91CD\u590D\u7684\u8F66\u8F86");
    });
  });
  if (home && home in locations) {
    const seen = /* @__PURE__ */ new Set([home]);
    const queue = [home];
    while (queue.length) {
      const cur = queue.shift();
      const tm = isObj(locations[cur]) && isObj(locations[cur].travelMinutes) ? locations[cur].travelMinutes : {};
      for (const to of Object.keys(tm)) if (to in locations && !seen.has(to)) seen.add(to), queue.push(to);
    }
    for (const id of Object.keys(locations)) if (!seen.has(id)) c.err(`$.locations.${id}`, `\u4ECE home("${home}") \u65E0\u6CD5\u5230\u8FBE`);
    for (const [id, loc] of Object.entries(locations)) {
      const tm = isObj(loc) && isObj(loc.travelMinutes) ? loc.travelMinutes : {};
      for (const to of Object.keys(tm)) {
        const back = isObj(locations[to]) && isObj(locations[to].travelMinutes) ? locations[to].travelMinutes : null;
        if (back && !(id in back)) c.err(`$.locations.${id}.travelMinutes.${to}`, `"${to}" \u6CA1\u6709\u56DE\u5230 "${id}" \u7684\u8DEF\u7EBF`);
      }
    }
  }
  c.table(root.areas, "$.areas", (o, _id, p) => {
    c.str(o.name, `${p}.name`);
    if (typeof o.description !== "string") c.err(`${p}.description`, "\u5E94\u4E3A\u5B57\u7B26\u4E32");
    c.num(o.minutes, `${p}.minutes`, { int: true, gt: 0 });
    c.num(o.danger, `${p}.danger`, { min: 0, max: 1 });
    c.range(o.injury, `${p}.injury`);
    c.range(o.rolls, `${p}.rolls`);
    c.opt(o.unlockDay, (v) => c.num(v, `${p}.unlockDay`, { int: true, min: 1 }));
    const loot = c.arr(o.loot, `${p}.loot`);
    if (loot && loot.length === 0) c.err(`${p}.loot`, "\u4E0D\u80FD\u4E3A\u7A7A");
    loot?.forEach((e, i) => {
      const lp = `${p}.loot[${i}]`;
      const lo = c.obj(e, lp);
      if (!lo) return;
      const it = c.str(lo.item, `${lp}.item`);
      if (it && !(it in items)) c.err(`${lp}.item`, `\u7269\u54C1 "${it}" \u4E0D\u5B58\u5728`);
      c.num(lo.weight, `${lp}.weight`, { gt: 0 });
      c.range(lo.qty, `${lp}.qty`, { min: 1 });
    });
  });
  const hordes = c.arr(root.hordes, "$.hordes");
  if (hordes) {
    let prev = [0, -1];
    hordes.forEach((h2, i) => {
      const p = `$.hordes[${i}]`;
      const o = c.obj(h2, p);
      if (!o) return;
      const day = c.num(o.day, `${p}.day`, { int: true, min: 1 });
      const off = c.num(o.offsetMinutes, `${p}.offsetMinutes`, { int: true, min: 0, max: 1439 });
      c.num(o.strength, `${p}.strength`, { gt: 0 });
      if (day !== null && targetDays > 0 && day > targetDays) c.err(`${p}.day`, `\u4E0D\u80FD\u665A\u4E8E targetDays(${targetDays})`);
      if (day !== null && off !== null) {
        if (day < prev[0] || day === prev[0] && off <= prev[1]) c.err(p, "\u5FC5\u987B\u6309 day / offsetMinutes \u4E25\u683C\u5347\u5E8F");
        prev = [day, off];
      }
    });
  }
  c.table(root.characters, "$.characters", (o, _id, p) => {
    c.str(o.name, `${p}.name`);
    if (typeof o.description !== "string") c.err(`${p}.description`, "\u5E94\u4E3A\u5B57\u7B26\u4E32");
    c.num(o.startMoney, `${p}.startMoney`, { int: true, min: 0 });
    c.qtyMap(o.startItems, `${p}.startItems`, items, { allowEmpty: true });
    c.opt(o.modifiers, (v) => {
      const m = c.obj(v, `${p}.modifiers`);
      if (!m) return;
      for (const k of ["priceMult", "scavengeDangerMult", "statDecayMult"]) c.opt(m[k], (x) => c.num(x, `${p}.modifiers.${k}`, { gt: 0 }));
      for (const k of Object.keys(m)) if (!["priceMult", "scavengeDangerMult", "statDecayMult"].includes(k)) c.err(`${p}.modifiers.${k}`, "\u672A\u77E5\u4FEE\u9970\u9879");
    });
  });
  c.table(root.perks, "$.perks", (o, _id, p) => {
    c.str(o.name, `${p}.name`);
    if (typeof o.description !== "string") c.err(`${p}.description`, "\u5E94\u4E3A\u5B57\u7B26\u4E32");
    c.num(o.cost, `${p}.cost`, { int: true, min: 0 });
    const e = c.obj(o.effect, `${p}.effect`);
    if (!e) return;
    c.opt(e.startMoney, (v) => c.num(v, `${p}.effect.startMoney`, { int: true, min: 0 }));
    c.opt(e.startItems, (v) => c.qtyMap(v, `${p}.effect.startItems`, items));
    c.opt(e.startStats, (v) => c.partialStats(v, `${p}.effect.startStats`));
    c.opt(e.backpackRows, (v) => c.num(v, `${p}.effect.backpackRows`, { int: true, min: 0 }));
  });
  c.table(root.vehicles, "$.vehicles", (o, _id, p) => {
    c.str(o.name, `${p}.name`);
    if (typeof o.description !== "string") c.err(`${p}.description`, "\u5E94\u4E3A\u5B57\u7B26\u4E32");
    c.num(o.price, `${p}.price`, { int: true, min: 1 });
    c.grid(o.trunkGrid, `${p}.trunkGrid`);
    c.num(o.travelMult, `${p}.travelMult`, { gt: 0, max: 1 });
  });
  if (isObj(root.config) && isObj(root.config.backpackGrid)) {
    const bg = root.config.backpackGrid;
    const spoiled = typeof root.config.spoiledItem === "string" ? items[root.config.spoiledItem] : void 0;
    for (const [id, it] of Object.entries(items)) {
      if (!isObj(it)) continue;
      const rows = Array.isArray(it.shape) && it.shape.every((r) => typeof r === "string") ? it.shape : ["X"];
      const h2 = rows.length;
      const wd = Math.max(...rows.map((r) => r.length));
      if (isNum(bg.w) && isNum(bg.h) && !(wd <= bg.w && h2 <= bg.h || h2 <= bg.w && wd <= bg.h)) c.err(`$.items.${id}.shape`, "\u7A7A\u80CC\u5305\u91CC\u4E5F\u653E\u4E0D\u4E0B");
      if (spoiled && it.shelfLifeMinutes !== void 0 && isNum(it.stack) && isNum(spoiled.stack ?? 1) && it.stack > (spoiled.stack ?? 1))
        c.err(`$.items.${id}.stack`, `\u4F1A\u8150\u8D25,\u53E0\u653E\u4E0A\u9650 ${it.stack} \u4E0D\u80FD\u5927\u4E8E\u8150\u8D25\u7269\u7684 ${spoiled.stack ?? 1}`);
    }
    if (spoiled && Array.isArray(spoiled.shape) && !(spoiled.shape.length === 1 && spoiled.shape[0] === "X")) c.err(`$.items.${String(root.config.spoiledItem)}.shape`, "\u8150\u8D25\u7269\u5FC5\u987B\u662F 1\xD71");
  }
  void crops;
  if (c.errors.length) throw new Error(`\u6E38\u620F\u6570\u636E\u6821\u9A8C\u5931\u8D25(${c.errors.length} \u5904):
${c.errors.join("\n")}`);
  return raw;
}

// src/data/content/config.json
var config_default = {
  startHour: 8,
  stockpileMinutes: 600,
  targetDays: 14,
  tickMinutes: 1,
  statMax: 100,
  startStats: { satiety: 70, health: 100, energy: 80, mood: 70 },
  baseRates: { satiety: -0.07, health: 0, energy: -0.05, mood: -8e-3 },
  activityEnergy: { idle: -0.05, work: -0.12, sleep: 0.25, travel: -0.1 },
  sleepDecayMult: 0.4,
  homeLocation: "home",
  buyMinutes: 5,
  backpackGrid: { w: 6, h: 4 },
  homeGrid: { w: 12, h: 10 },
  stackAgeFraction: 0.05,
  plantMinutes: 15,
  harvestMinutes: 10,
  buyQuantities: [1, 3, 5],
  sleepHoursOptions: [4, 8],
  waitMinutesOptions: [30, 120],
  priceBands: [
    { fromMinute: 0, mult: 1 }
  ],
  awayPenalty: { lossFraction: 0.5, healthLoss: 25 },
  fuelItem: "fuel",
  spoiledItem: "rotten",
  gridOutageDay: 4,
  nightStartHour: 21,
  nightEndHour: 5,
  nightDangerMult: 1.6,
  breach: { damagePerPoint: 6, lossFraction: 0.3 },
  points: { perDay: 10, victoryBonus: 100 }
};

// src/data/content/items.json
var items_default = {
  instant_noodle: { id: "instant_noodle", name: "\u65B9\u4FBF\u9762", category: "food", shelfLifeMinutes: 43200, use: { minutes: 10, stats: { satiety: 22, mood: 1 } }, stack: 5, glyph: "\u9762" },
  canned_food: { id: "canned_food", name: "\u7F50\u5934", category: "food", shelfLifeMinutes: 43200, use: { minutes: 10, stats: { satiety: 30 } }, stack: 4, glyph: "\u7F50" },
  bread: { id: "bread", name: "\u9762\u5305", category: "food", shelfLifeMinutes: 2880, use: { minutes: 5, stats: { satiety: 20, mood: 2 } }, stack: 3, glyph: "\u5305" },
  rice: { id: "rice", name: "\u5927\u7C73", category: "material", shelfLifeMinutes: 6e4, shape: ["XX", "XX"], glyph: "\u7C73" },
  meat: { id: "meat", name: "\u9C9C\u8089", category: "material", shelfLifeMinutes: 1440, shape: ["XX"], glyph: "\u8089" },
  vegetable: { id: "vegetable", name: "\u852C\u83DC", category: "food", shelfLifeMinutes: 1800, use: { minutes: 5, stats: { satiety: 10, health: 1 } }, stack: 4, glyph: "\u852C" },
  potato: { id: "potato", name: "\u571F\u8C46", category: "food", shelfLifeMinutes: 6e3, use: { minutes: 10, stats: { satiety: 16 } }, stack: 6, glyph: "\u8C46" },
  cooked_meal: { id: "cooked_meal", name: "\u70ED\u996D\u83DC", category: "food", shelfLifeMinutes: 720, use: { minutes: 15, stats: { satiety: 40, mood: 9, health: 2 } }, stack: 3, glyph: "\u996D" },
  water_bottle: { id: "water_bottle", name: "\u74F6\u88C5\u6C34", category: "drink", use: { minutes: 1, stats: { satiety: 3, mood: 0.5 } }, shape: ["X", "X"], stack: 3, glyph: "\u6C34" },
  medicine: { id: "medicine", name: "\u6297\u751F\u7D20", category: "medicine", use: { minutes: 2, stats: { health: 12 }, removeEffects: ["infection"] }, stack: 5, glyph: "\u836F" },
  bandage: { id: "bandage", name: "\u7EF7\u5E26", category: "medicine", use: { minutes: 3, stats: { health: 8 } }, stack: 5, glyph: "\u7EF7" },
  snack: { id: "snack", name: "\u96F6\u98DF", category: "food", shelfLifeMinutes: 2e4, use: { minutes: 2, stats: { satiety: 6, mood: 8 } }, stack: 5, glyph: "\u96F6" },
  wood: { id: "wood", name: "\u6728\u677F", category: "material", shape: ["XXX"], stack: 2, glyph: "\u6728" },
  metal: { id: "metal", name: "\u91D1\u5C5E\u4EF6", category: "material", shape: ["XX", "X."], stack: 2, glyph: "\u94C1" },
  scrap: { id: "scrap", name: "\u5E9F\u6599", category: "material", stack: 5, glyph: "\u5E9F" },
  fuel: { id: "fuel", name: "\u71C3\u6599", category: "fuel", shape: ["X", "X"], stack: 2, glyph: "\u6CB9" },
  seed_potato: { id: "seed_potato", name: "\u571F\u8C46\u79CD", category: "seed", stack: 10, glyph: "\u85AF" },
  seed_veg: { id: "seed_veg", name: "\u83DC\u79CD", category: "seed", stack: 10, glyph: "\u83DC" },
  seed_corn: { id: "seed_corn", name: "\u7389\u7C73\u79CD", category: "seed", stack: 10, glyph: "\u7C9F" },
  corn: { id: "corn", name: "\u7389\u7C73", category: "food", shelfLifeMinutes: 5e3, use: { minutes: 8, stats: { satiety: 18 } }, stack: 4, glyph: "\u7389" },
  rotten: { id: "rotten", name: "\u8150\u8D25\u7269", category: "junk", use: { minutes: 5, stats: { satiety: 8, health: -6 }, applyEffects: ["infection"] }, stack: 6, glyph: "\u8150" }
};

// src/data/content/effects.json
var effects_default = {
  hungry: { id: "hungry", name: "\u9965\u997F", description: "\u9971\u8179\u8FC7\u4F4E,\u4F53\u529B\u5728\u6D41\u5931", when: [{ stat: "satiety", op: "<", value: 15 }], perMinute: { health: -0.03, mood: -0.03 }, deathCause: "starvation" },
  starving: { id: "starving", name: "\u6781\u5EA6\u9965\u997F", description: "\u5DF2\u7ECF\u997F\u5230\u773C\u524D\u53D1\u9ED1", when: [{ stat: "satiety", op: "<", value: 3 }], perMinute: { health: -0.15 }, deathCause: "starvation" },
  exhausted: { id: "exhausted", name: "\u7CBE\u75B2\u529B\u7AED", description: "\u505A\u4EC0\u4E48\u90FD\u6162\u534A\u62CD", when: [{ stat: "energy", op: "<", value: 15 }], perMinute: { mood: -0.04 }, actionTimeMult: 1.5 },
  collapsing: { id: "collapsing", name: "\u6FD2\u4E34\u5D29\u6E83", description: "\u8EAB\u4F53\u5728\u5F3A\u884C\u5173\u673A", when: [{ stat: "energy", op: "<", value: 3 }], perMinute: { health: -0.1 }, actionTimeMult: 2, deathCause: "exhaustion" },
  lonely: { id: "lonely", name: "\u5B64\u5BC2", description: "\u4E00\u4E2A\u4EBA\u592A\u4E45\u4E86", when: [{ stat: "mood", op: "<", value: 20 }], perMinute: { energy: -0.03 } },
  despair: { id: "despair", name: "\u7EDD\u671B", description: "\u4EC0\u4E48\u90FD\u4E0D\u60F3\u505A\u4E86", when: [{ stat: "mood", op: "<", value: 5 }], perMinute: { health: -0.05 }, actionTimeMult: 1.3, deathCause: "despair" },
  infection: { id: "infection", name: "\u611F\u67D3", description: "\u4F24\u53E3\u5728\u53D1\u708E,\u9700\u8981\u6297\u751F\u7D20", durationMinutes: 2880, perMinute: { health: -0.04, energy: -0.02 }, deathCause: "infection" }
};

// src/data/content/weather.json
var weather_default = {
  clear: { id: "clear", name: "\u6674", weight: 5, minDay: 1 },
  cloudy: { id: "cloudy", name: "\u9634", weight: 3, minDay: 1, perMinute: { mood: -5e-3 } },
  heatwave: { id: "heatwave", name: "\u9177\u6691", weight: 2, minDay: 2, perMinute: { satiety: -0.03, energy: -0.03 } },
  coldsnap: { id: "coldsnap", name: "\u5BD2\u6F6E", weight: 2, minDay: 3, perMinute: { energy: -0.04, mood: -0.02 } },
  storm: { id: "storm", name: "\u66B4\u96E8", weight: 2, minDay: 2, perMinute: { mood: -0.03 }, blocksScavenge: true, blackout: true }
};

// src/data/content/facilities.json
var facilities_default = {
  bed: { id: "bed", name: "\u7B80\u6613\u5E8A\u94FA", description: "\u6709\u4E2A\u50CF\u6837\u7684\u5E8A,\u7761\u5F97\u8E0F\u5B9E\u4E9B\u3002", levels: [
    { cost: { wood: 2 }, buildMinutes: 40 }
  ] },
  door: { id: "door", name: "\u52A0\u56FA\u95E8\u7A97", description: "\u6321\u4F4F\u5C38\u6F6E\u7684\u7B2C\u4E00\u9053\u9632\u7EBF\u3002", levels: [
    { cost: { wood: 4 }, buildMinutes: 60, defense: 3 },
    { cost: { wood: 6, metal: 3 }, buildMinutes: 90, defense: 7 },
    { cost: { wood: 8, metal: 8 }, buildMinutes: 120, defense: 12 }
  ] },
  barricade: { id: "barricade", name: "\u7535\u7F51\u9677\u9631", description: "\u9700\u8981\u901A\u7535\u624D\u6709\u6548\u7684\u7535\u7F51\u4E0E\u8B66\u62A5\u3002", levels: [
    { cost: { metal: 5, scrap: 5 }, buildMinutes: 90, defense: 4, needsPower: true },
    { cost: { metal: 8, scrap: 8 }, buildMinutes: 120, defense: 9, needsPower: true }
  ] },
  fridge: { id: "fridge", name: "\u51B0\u7BB1", description: "\u653E\u5728\u91CC\u9762\u7684\u98DF\u7269\u8150\u8D25\u5927\u5E45\u51CF\u7F13\u3002\u9700\u8981\u901A\u7535\u3002", levels: [
    { cost: { metal: 4, scrap: 3 }, buildMinutes: 60, storage: { grid: { w: 4, h: 4 }, spoilMult: 0.3, needsPower: true, accepts: ["food", "drink", "material"] } }
  ] },
  shelf: { id: "shelf", name: "\u50A8\u7269\u67B6", description: "\u7269\u8D44\u6446\u4E0A\u67B6\u5B50,\u5C38\u6F6E\u7834\u95E8\u65F6\u635F\u5931\u5C11\u5F97\u591A\u3002", levels: [
    { cost: { wood: 1, scrap: 3 }, buildMinutes: 40, storage: { grid: { w: 6, h: 5 }, breachLossMult: 0.3 } }
  ] },
  stash: { id: "stash", name: "\u6697\u683C", description: "\u85CF\u5728\u5899\u91CC\u7684\u5C0F\u7A7A\u95F4,\u5C38\u6F6E\u627E\u4E0D\u5230\u3002\u653E\u4EC0\u4E48\u7531\u4F60\u51B3\u5B9A\u3002", levels: [
    { cost: { wood: 2, metal: 1 }, buildMinutes: 60, storage: { grid: { w: 3, h: 2 }, breachLossMult: 0, autoFill: false } }
  ] },
  planter: { id: "planter", name: "\u79CD\u690D\u7BB1", description: "\u9633\u53F0\u4E0A\u7684\u79CD\u690D\u4F4D\u3002", levels: [
    { cost: { wood: 3 }, buildMinutes: 45, cropSlots: 2 },
    { cost: { wood: 4, scrap: 2 }, buildMinutes: 60, cropSlots: 4 }
  ] },
  generator: { id: "generator", name: "\u53D1\u7535\u673A", description: "\u7535\u7F51\u65AD\u540E\u7684\u5907\u7528\u7535\u6E90,\u70E7\u71C3\u6599\u3002", levels: [
    { cost: { metal: 6, scrap: 6 }, buildMinutes: 90, providesPower: true, fuelPerHour: 0.5 }
  ] },
  stove: { id: "stove", name: "\u7076\u53F0", description: "\u89E3\u9501\u70F9\u996A\u3002", levels: [
    { cost: { metal: 2, scrap: 2 }, buildMinutes: 30 }
  ] }
};

// src/data/content/recipes.json
var recipes_default = {
  cook_rice_meal: { id: "cook_rice_meal", name: "\u86CB\u7092\u996D", inputs: { rice: 1, vegetable: 1 }, outputs: { cooked_meal: 2 }, minutes: 30, requiresFacility: "stove" },
  cook_meat_meal: { id: "cook_meat_meal", name: "\u7EA2\u70E7\u8089\u996D", inputs: { rice: 1, meat: 1 }, outputs: { cooked_meal: 3 }, minutes: 40, requiresFacility: "stove" },
  cook_potato: { id: "cook_potato", name: "\u70E4\u571F\u8C46", inputs: { potato: 2 }, outputs: { cooked_meal: 1 }, minutes: 25, requiresFacility: "stove" },
  cook_plain_rice: { id: "cook_plain_rice", name: "\u767D\u7C73\u996D", inputs: { rice: 1 }, outputs: { cooked_meal: 1 }, minutes: 25, requiresFacility: "stove" }
};

// src/data/content/crops.json
var crops_default = {
  potato: { id: "potato", name: "\u571F\u8C46", seedItem: "seed_potato", growMinutes: 2880, yield: { potato: 5, seed_potato: 1 } },
  veg: { id: "veg", name: "\u9752\u83DC", seedItem: "seed_veg", growMinutes: 1440, yield: { vegetable: 3, seed_veg: 1 } },
  corn: { id: "corn", name: "\u7389\u7C73", seedItem: "seed_corn", growMinutes: 4320, yield: { corn: 8, seed_corn: 1 } }
};

// src/data/content/locations.json
var locations_default = {
  home: { id: "home", name: "\u5BB6", travelMinutes: { supermarket: 20, hardware: 30, market: 25, car_lot: 25 } },
  car_lot: { id: "car_lot", name: "\u4E8C\u624B\u8F66\u573A", travelMinutes: { home: 25, supermarket: 20, hardware: 15, market: 25 }, vehicles: ["van"] },
  supermarket: { id: "supermarket", name: "\u8D85\u5E02", travelMinutes: { home: 20, hardware: 15, market: 12, car_lot: 20 }, stock: [
    { item: "instant_noodle", price: 6, qty: 20 },
    { item: "canned_food", price: 12, qty: 14 },
    { item: "bread", price: 5, qty: 10 },
    { item: "water_bottle", price: 3, qty: 30 },
    { item: "snack", price: 8, qty: 10 },
    { item: "rice", price: 20, qty: 8 },
    { item: "bandage", price: 10, qty: 6 }
  ] },
  hardware: { id: "hardware", name: "\u5DE5\u5177\u5E97", travelMinutes: { home: 30, supermarket: 15, market: 20, car_lot: 15 }, stock: [
    { item: "wood", price: 15, qty: 14 },
    { item: "metal", price: 25, qty: 12 },
    { item: "scrap", price: 8, qty: 14 },
    { item: "fuel", price: 30, qty: 8 },
    { item: "medicine", price: 40, qty: 3 }
  ] },
  market: { id: "market", name: "\u519C\u8D38\u5E02\u573A", travelMinutes: { home: 25, supermarket: 12, hardware: 20, car_lot: 25 }, stock: [
    { item: "meat", price: 25, qty: 6 },
    { item: "vegetable", price: 5, qty: 14 },
    { item: "potato", price: 4, qty: 20 },
    { item: "seed_potato", price: 10, qty: 6 },
    { item: "seed_veg", price: 8, qty: 6 },
    { item: "seed_corn", price: 12, qty: 4 }
  ] }
};

// src/data/content/areas.json
var areas_default = {
  stairwell: {
    id: "stairwell",
    name: "\u697C\u9053",
    description: "\u90BB\u5C45\u7559\u4E0B\u7684\u6742\u7269,\u51E0\u4E4E\u6CA1\u6709\u5371\u9669\u3002",
    minutes: 40,
    danger: 0.08,
    injury: [4, 8],
    rolls: [1, 2],
    loot: [
      { item: "scrap", weight: 4, qty: [1, 2] },
      { item: "wood", weight: 2, qty: [1, 1] },
      { item: "water_bottle", weight: 2, qty: [1, 2] },
      { item: "snack", weight: 1, qty: [1, 1] }
    ]
  },
  street: {
    id: "street",
    name: "\u8857\u89D2\u4FBF\u5229\u5E97",
    description: "\u8D27\u67B6\u88AB\u626B\u8361\u8FC7,\u4F46\u4ECD\u6709\u6B8B\u4F59\u3002",
    minutes: 70,
    danger: 0.25,
    injury: [8, 16],
    rolls: [2, 3],
    loot: [
      { item: "instant_noodle", weight: 3, qty: [1, 3] },
      { item: "canned_food", weight: 2, qty: [1, 2] },
      { item: "water_bottle", weight: 3, qty: [1, 3] },
      { item: "bandage", weight: 1, qty: [1, 2] },
      { item: "scrap", weight: 2, qty: [1, 2] }
    ]
  },
  hospital: {
    id: "hospital",
    name: "\u793E\u533A\u8BCA\u6240",
    description: "\u836F\u54C1\u5145\u8DB3,\u5C38\u7FA4\u4E5F\u662F\u3002",
    minutes: 100,
    danger: 0.4,
    injury: [12, 24],
    rolls: [2, 3],
    unlockDay: 3,
    loot: [
      { item: "medicine", weight: 3, qty: [1, 2] },
      { item: "bandage", weight: 4, qty: [1, 3] },
      { item: "water_bottle", weight: 2, qty: [1, 2] }
    ]
  },
  warehouse: {
    id: "warehouse",
    name: "\u7269\u6D41\u4ED3\u5E93",
    description: "\u5EFA\u6750\u3001\u71C3\u6599\u548C\u91D1\u5C5E\u4EF6\u3002",
    minutes: 120,
    danger: 0.5,
    injury: [15, 28],
    rolls: [3, 4],
    unlockDay: 4,
    loot: [
      { item: "metal", weight: 4, qty: [1, 3] },
      { item: "wood", weight: 3, qty: [1, 3] },
      { item: "fuel", weight: 2, qty: [1, 2] },
      { item: "scrap", weight: 3, qty: [1, 3] },
      { item: "canned_food", weight: 2, qty: [1, 3] }
    ]
  },
  supermarket_ruins: {
    id: "supermarket_ruins",
    name: "\u6CA6\u9677\u7684\u5927\u578B\u8D85\u5E02",
    description: "\u6700\u540E\u7684\u5927\u5B9D\u5E93,\u770B\u4F60\u6709\u6CA1\u6709\u547D\u62FF\u3002",
    minutes: 150,
    danger: 0.6,
    injury: [20, 35],
    rolls: [3, 5],
    unlockDay: 6,
    loot: [
      { item: "canned_food", weight: 4, qty: [2, 4] },
      { item: "instant_noodle", weight: 3, qty: [2, 4] },
      { item: "rice", weight: 2, qty: [1, 2] },
      { item: "medicine", weight: 1, qty: [1, 1] },
      { item: "seed_corn", weight: 1, qty: [1, 2] }
    ]
  }
};

// src/data/content/hordes.json
var hordes_default = [
  { day: 3, offsetMinutes: 1260, strength: 3 },
  { day: 5, offsetMinutes: 1260, strength: 6 },
  { day: 7, offsetMinutes: 1260, strength: 9 },
  { day: 9, offsetMinutes: 1260, strength: 12 },
  { day: 11, offsetMinutes: 1260, strength: 15 },
  { day: 13, offsetMinutes: 1260, strength: 19 }
];

// src/data/content/characters.json
var characters_default = {
  worker: { id: "worker", name: "\u6253\u5DE5\u4ED4", description: "\u542F\u52A8\u8D44\u91D1\u6700\u591A,\u4F53\u529B\u548C\u5FC3\u6001\u666E\u901A\u3002", startMoney: 1680, startItems: { instant_noodle: 2, water_bottle: 2 } },
  student: { id: "student", name: "\u5927\u5B66\u751F", description: "\u94B1\u5C11,\u4F46\u4F1A\u780D\u4EF7,\u6D88\u8017\u4E5F\u66F4\u4F4E\u3002", startMoney: 900, startItems: { snack: 3, water_bottle: 1 }, modifiers: { priceMult: 0.85, statDecayMult: 0.9 } },
  keeper: { id: "keeper", name: "\u4ED3\u5E93\u7BA1\u7406\u5458", description: "\u719F\u6089\u641C\u522E,\u906D\u9047\u5371\u9669\u66F4\u5C11,\u4F46\u624B\u5934\u7684\u94B1\u4E0D\u591A\u3002", startMoney: 1200, startItems: { canned_food: 2, bandage: 1 }, modifiers: { scavengeDangerMult: 0.7 } }
};

// src/data/content/perks.json
var perks_default = {
  savings: { id: "savings", name: "\u672A\u96E8\u7EF8\u7F2A", description: "\u8BB0\u4F4F\u4E86\u56E4\u8D27\u7684\u6700\u4F73\u65F6\u673A:\u5F00\u5C40\u591A 300 \u5143\u3002", cost: 30, effect: { startMoney: 300 } },
  pantry: { id: "pantry", name: "\u50A8\u7269\u67DC", description: "\u5F00\u5C40\u643A\u5E26 3 \u7F50\u7F50\u5934\u548C 3 \u74F6\u6C34\u3002", cost: 40, effect: { startItems: { canned_food: 3, water_bottle: 3 } } },
  calm: { id: "calm", name: "\u5FC3\u7406\u51C6\u5907", description: "\u9884\u77E5\u707E\u96BE,\u5FC3\u6001 +15\u3002", cost: 40, effect: { startStats: { mood: 15 } } },
  toolkit: { id: "toolkit", name: "\u5DE5\u5177\u7BB1", description: "\u5F00\u5C40\u5E26 4 \u5757\u6728\u677F\u548C 2 \u4E2A\u91D1\u5C5E\u4EF6\u3002", cost: 60, effect: { startItems: { wood: 4, metal: 2 } } },
  hiking_pack: { id: "hiking_pack", name: "\u767B\u5C71\u5305", description: "\u4E0A\u4E00\u8F6E\u5403\u591F\u4E86\u6765\u56DE\u8DD1\u7684\u82E6:\u80CC\u5305\u591A 2 \u884C\u683C\u5B50\u3002", cost: 50, effect: { backpackRows: 2 } },
  loop_veteran: { id: "loop_veteran", name: "\u8001\u8F6E\u56DE\u8005", description: "\u5F00\u5C40\u591A 600 \u5143\u3002", cost: 100, effect: { startMoney: 600 } }
};

// src/data/content/vehicles.json
var vehicles_default = {
  van: { id: "van", name: "\u4E8C\u624B\u9762\u5305\u8F66", description: "\u5F00\u5F97\u52A8\u5C31\u884C\u3002\u540E\u5907\u7BB1\u80FD\u591A\u88C5\u4E0D\u5C11,\u8DD1\u4E00\u8D9F\u4E5F\u5FEB\u3002", price: 300, trunkGrid: { w: 8, h: 5 }, travelMult: 0.6 }
};

// src/data/index.ts
var cached = null;
function loadGameData() {
  if (!cached) {
    cached = validateGameData({ config: config_default, items: items_default, effects: effects_default, weather: weather_default, facilities: facilities_default, recipes: recipes_default, crops: crops_default, locations: locations_default, areas: areas_default, hordes: hordes_default, characters: characters_default, perks: perks_default, vehicles: vehicles_default });
  }
  return cached;
}

// src/core/rng.ts
function nextRandom(holder) {
  holder.rng = holder.rng + 1831565813 | 0;
  let t = holder.rng;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
function hashSeed(...parts) {
  let h2 = 2166136261 | 0;
  for (const p of parts) {
    h2 ^= p | 0;
    h2 = Math.imul(h2, 16777619);
    h2 ^= h2 >>> 15;
    h2 = Math.imul(h2, 2246822507);
    h2 ^= h2 >>> 13;
  }
  return h2 | 0;
}
function hashUnit(...parts) {
  return nextRandom({ rng: hashSeed(...parts) });
}

// src/core/ctx.ts
function makeCtx(data2, session2) {
  return { data: data2, meta: session2.meta, run: session2.run, events: [] };
}
var DEFAULT_TAG = {
  arrived: "info",
  bought: "info",
  vehicle_bought: "good",
  moved: "info",
  unloaded: "info",
  to_hand: "warn",
  stowed: "info",
  arranged: "info",
  hand_left: "warn",
  disaster_begins: "danger",
  away_penalty: "danger",
  day_start: "info",
  used: "info",
  discarded: "info",
  slept: "info",
  waited: "info",
  cooked: "good",
  planted: "info",
  crop_ready: "good",
  harvested: "good",
  built: "good",
  spoiled: "warn",
  effect_started: "warn",
  effect_ended: "info",
  power_changed: "warn",
  scavenged: "good",
  loot_left_behind: "warn",
  scavenge_injury: "danger",
  horde_arrives: "warn",
  horde_repelled: "good",
  horde_breach: "danger",
  death: "danger",
  victory: "good",
  run_settled: "info",
  perk_bought: "good",
  rebirth: "info"
};
function emit(ctx, e) {
  ctx.events.push({ ...e, t: ctx.run.minute, tag: e.tag ?? DEFAULT_TAG[e.code] });
}
function rand(ctx) {
  return nextRandom(ctx.run);
}
function randInt(ctx, min, max) {
  return min + Math.floor(rand(ctx) * (max - min + 1));
}
function pickWeighted(ctx, items, weight) {
  let total = 0;
  for (const it of items) total += weight(it);
  let r = rand(ctx) * total;
  for (const it of items) {
    r -= weight(it);
    if (r < 0) return it;
  }
  return items[items.length - 1];
}

// src/core/grid.ts
var cellsCache = /* @__PURE__ */ new Map();
function shapeCells(shape, rot) {
  const key = `${shape.join("/")}@${rot}`;
  let cells = cellsCache.get(key);
  if (!cells) {
    let pts = [];
    shape.forEach((row, y) => [...row].forEach((ch, x) => ch === "X" && pts.push([x, y])));
    for (let r = 0; r < rot; r += 90) {
      const h2 = Math.max(...pts.map(([, y]) => y)) + 1;
      pts = pts.map(([x, y]) => [h2 - 1 - y, x]);
    }
    const minX = Math.min(...pts.map(([x]) => x));
    const minY = Math.min(...pts.map(([, y]) => y));
    cells = pts.map(([x, y]) => [x - minX, y - minY]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    cellsCache.set(key, cells);
  }
  return cells;
}
function distinctRotations(shape) {
  const seen = /* @__PURE__ */ new Set();
  return ROTATIONS.filter((rot) => {
    const sig = shapeCells(shape, rot).join(";");
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}
function emptyOccupancy(size) {
  return new Int32Array(size.w * size.h);
}
function mark(occ, size, cells, x, y, id) {
  for (const [cx, cy] of cells) occ[(y + cy) * size.w + (x + cx)] = id;
}
function inBounds(size, cells, x, y) {
  return cells.every(([cx, cy]) => x + cx >= 0 && y + cy >= 0 && x + cx < size.w && y + cy < size.h);
}
function blockersAt(occ, size, cells, x, y) {
  const ids = [];
  for (const [cx, cy] of cells) {
    const id = occ[(y + cy) * size.w + (x + cx)];
    if (id !== 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
function firstFit(occ, size, shape, rots) {
  for (const rot of rots) {
    const cells = shapeCells(shape, rot);
    for (let y = 0; y < size.h; y++) {
      for (let x = 0; x < size.w; x++) {
        if (inBounds(size, cells, x, y) && blockersAt(occ, size, cells, x, y).length === 0) return { x, y, rot };
      }
    }
  }
  return null;
}

// src/core/inventory.ts
var inWhere = (s, where) => !where || where.includes(s.where);
function countItem(run, item, where) {
  let n = 0;
  for (const s of run.inventory) if (s.item === item && inWhere(s, where)) n += s.qty;
  return n;
}
function hasItems(run, req, where) {
  for (const [item, qty] of Object.entries(req)) if (countItem(run, item, where) < qty) return false;
  return true;
}
function newPiece(run, p) {
  if (!Number.isInteger(p.qty) || p.qty <= 0) throw new Error(`newPiece: bad qty ${p.qty}`);
  const s = { id: run.nextPieceId++, ...p };
  run.inventory.push(s);
  return s;
}
function applyPlan(run, item, age, plan) {
  for (const op of plan.ops) {
    if (op.kind === "merge") {
      const s = run.inventory.find((x) => x.id === op.id);
      if (!s) throw new Error(`applyPlan: no piece ${op.id}`);
      s.qty += op.qty;
      s.age = Math.max(s.age, age);
    } else {
      newPiece(run, { item, qty: op.qty, age, where: op.where, x: op.x, y: op.y, rot: op.rot });
    }
  }
}
function takeItem(run, item, qty, where) {
  if (!Number.isInteger(qty) || qty <= 0) throw new Error(`takeItem: bad qty ${qty}`);
  if (countItem(run, item, where) < qty) return null;
  const rank = (s) => where ? where.indexOf(s.where) : 0;
  const stacks = run.inventory.filter((s) => s.item === item && inWhere(s, where)).sort((a, b) => b.age - a.age || rank(a) - rank(b) || a.id - b.id);
  const taken = [];
  let left = qty;
  for (const s of stacks) {
    const take = Math.min(s.qty, left);
    s.qty -= take;
    left -= take;
    taken.push({ ...s, qty: take });
    if (left === 0) break;
  }
  run.inventory = run.inventory.filter((s) => s.qty > 0);
  return taken;
}
function removeItem(run, item, qty, where) {
  return takeItem(run, item, qty, where) !== null;
}
function removeItems(run, req, where) {
  if (!hasItems(run, req, where)) return false;
  for (const [item, qty] of Object.entries(req)) if (qty > 0) removeItem(run, item, qty, where);
  return true;
}
function takeFromPiece(run, id, qty) {
  const s = run.inventory.find((x) => x.id === id);
  if (!s || !Number.isInteger(qty) || qty <= 0 || qty > s.qty) return null;
  s.qty -= qty;
  if (s.qty === 0) run.inventory = run.inventory.filter((x) => x !== s);
  return { ...s, qty };
}
function inventoryTotals(run, where) {
  const out = {};
  for (const s of run.inventory) if (inWhere(s, where)) out[s.item] = (out[s.item] ?? 0) + s.qty;
  return out;
}
function addTotals(into, item, qty) {
  if (qty > 0) into[item] = (into[item] ?? 0) + qty;
}

// src/core/world.ts
var DAY_MINUTES = 1440;
function clockMinuteOfDay(data2, minute) {
  return (data2.config.startHour * 60 + minute) % DAY_MINUTES;
}
function clockHour(data2, minute) {
  return Math.floor(clockMinuteOfDay(data2, minute) / 60);
}
function isNight(data2, minute) {
  const h2 = clockHour(data2, minute);
  const { nightStartHour: s, nightEndHour: e } = data2.config;
  return s <= e ? h2 >= s && h2 < e : h2 >= s || h2 < e;
}
function baseDay(data2, minute) {
  const s = data2.config.stockpileMinutes;
  return minute < s ? 0 : Math.floor((minute - s) / DAY_MINUTES) + 1;
}
function dayStartMinute(data2, day) {
  return data2.config.stockpileMinutes + (day - 1) * DAY_MINUTES;
}
function hordeMinute(data2, h2) {
  return dayStartMinute(data2, h2.day) + h2.offsetMinutes;
}
function victoryMinute(data2) {
  return data2.config.stockpileMinutes + data2.config.targetDays * DAY_MINUTES;
}
function weatherForDay(data2, meta, day) {
  const pool = Object.values(data2.weather).filter((w) => w.minDay <= day).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (pool.length === 0) throw new Error(`no weather available for day ${day}`);
  let total = 0;
  for (const w of pool) total += w.weight;
  let r = hashUnit(meta.worldSeed, day, 30698) * total;
  for (const w of pool) {
    r -= w.weight;
    if (r < 0) return w;
  }
  return pool[pool.length - 1];
}
function currentWeather(w) {
  const d = baseDay(w.data, w.run.minute);
  return d >= 1 ? weatherForDay(w.data, w.meta, d) : null;
}
function facilityLevel(run, id) {
  return run.facilities[id] ?? 0;
}
function levelDef(data2, id, level) {
  if (level < 1) return null;
  return data2.facilities[id]?.levels[level - 1] ?? null;
}
function builtLevels(w) {
  const out = [];
  for (const id of Object.keys(w.data.facilities).sort()) {
    const level = facilityLevel(w.run, id);
    const def = levelDef(w.data, id, level);
    if (def) out.push({ id, level, def });
  }
  return out;
}
function gridAvailable(w) {
  const d = baseDay(w.data, w.run.minute);
  if (d === 0) return true;
  if (d >= w.data.config.gridOutageDay) return false;
  return !weatherForDay(w.data, w.meta, d).blackout;
}
function generatorRunnable(w) {
  if (!builtLevels(w).some((b) => b.def.providesPower)) return false;
  return w.run.fuelLeft > 0 || countItem(w.run, w.data.config.fuelItem, accessibleContainers(w)) > 0;
}
function powerState(w) {
  if (gridAvailable(w)) return "grid";
  return generatorRunnable(w) ? "generator" : "off";
}
function totalDefense(w) {
  const powered = powerState(w) !== "off";
  let sum = 0;
  for (const b of builtLevels(w)) {
    if (b.def.needsPower && !powered) continue;
    sum += b.def.defense ?? 0;
  }
  return sum;
}
function cropSlotCount(w) {
  let n = 0;
  for (const b of builtLevels(w)) n += b.def.cropSlots ?? 0;
  return n;
}
function itemShape(data2, item) {
  return data2.items[item]?.shape ?? ["X"];
}
function itemStack(data2, item) {
  return data2.items[item]?.stack ?? 1;
}
var storageIdsCache = /* @__PURE__ */ new WeakMap();
function storageFacilityIds(data2) {
  let ids = storageIdsCache.get(data2);
  if (!ids) {
    ids = Object.keys(data2.facilities).filter((id) => data2.facilities[id].levels.some((l) => l.storage)).sort();
    storageIdsCache.set(data2, ids);
  }
  return ids;
}
function isContainerId(data2, where) {
  if (where === BACKPACK || where === TRUNK || where === HOME || where === HAND) return true;
  return typeof where === "string" && storageFacilityIds(data2).includes(where);
}
function isHomeSide(where) {
  return where !== BACKPACK && where !== TRUNK && where !== HAND;
}
function storageOf(w, where) {
  if (!isHomeSide(where) || where === HOME) return null;
  return levelDef(w.data, where, facilityLevel(w.run, where))?.storage ?? null;
}
function containerExists(w, where) {
  if (where === BACKPACK || where === HOME || where === HAND) return true;
  if (where === TRUNK) return w.run.vehicle !== null && w.run.phase === "stockpile";
  return storageOf(w, where) !== null;
}
function containerError(w, where) {
  if (typeof where !== "string") return "invalid_argument";
  if (!isContainerId(w.data, where)) return "unknown_id";
  if (!containerExists(w, where)) return "container_unavailable";
  if (isHomeSide(where) && w.run.location !== w.data.config.homeLocation) return "not_at_home";
  return null;
}
function accessibleContainers(w) {
  return [HAND, BACKPACK, TRUNK, HOME, ...storageFacilityIds(w.data)].filter((c) => containerError(w, c) === null);
}
function homeContainers(w) {
  return [HOME, ...storageFacilityIds(w.data)].filter((c) => containerExists(w, c));
}
function gridOf(w, where) {
  if (where === HAND || !containerExists(w, where)) return null;
  if (where === BACKPACK) {
    let rows = 0;
    for (const id of w.meta.perks) rows += w.data.perks[id]?.effect.backpackRows ?? 0;
    const g = w.data.config.backpackGrid;
    return { w: g.w, h: g.h + rows };
  }
  if (where === TRUNK) return w.data.vehicles[w.run.vehicle]?.trunkGrid ?? null;
  if (where === HOME) return w.data.config.homeGrid;
  return storageOf(w, where)?.grid ?? null;
}
function containerUsed(w, where) {
  let n = 0;
  for (const s of w.run.inventory) if (s.where === where) n += where === HAND ? 1 : shapeCells(itemShape(w.data, s.item), s.rot).length;
  return n;
}
function occupancyOf(w, where, exclude = 0) {
  const size = gridOf(w, where);
  if (!size) return null;
  const occ = emptyOccupancy(size);
  for (const s of w.run.inventory) {
    if (s.where !== where || s.id === exclude) continue;
    mark(occ, size, shapeCells(itemShape(w.data, s.item), s.rot), s.x, s.y, s.id);
  }
  return occ;
}
function containerAccepts(w, where, item) {
  const accepts = storageOf(w, where)?.accepts;
  const cat = w.data.items[item]?.category;
  return !accepts || cat !== void 0 && accepts.includes(cat);
}
function containerSpoilMult(w, where) {
  const st = storageOf(w, where);
  if (!st || st.spoilMult === void 0) return 1;
  if (st.needsPower && powerState(w) === "off") return 1;
  return st.spoilMult;
}
function containerBreachMult(w, where) {
  return storageOf(w, where)?.breachLossMult ?? 1;
}
function canStackOnto(data2, item, age, s) {
  if (s.item !== item) return false;
  const shelf = data2.items[item]?.shelfLifeMinutes;
  if (shelf === void 0) return true;
  return Math.abs(s.age - age) <= shelf * data2.config.stackAgeFraction + 1e-9;
}
function planPlacement(w, item, qty, age, order) {
  const { data: data2 } = w;
  const stack = itemStack(data2, item);
  const shape = itemShape(data2, item);
  const rots = distinctRotations(shape);
  const ops = [];
  const placed = {};
  let left = qty;
  const add = (where, n) => placed[where] = (placed[where] ?? 0) + n;
  for (const where of order) {
    if (left === 0) break;
    if (!containerAccepts(w, where, item)) continue;
    for (const s of w.run.inventory) {
      if (left === 0) break;
      if (s.where !== where || !canStackOnto(data2, item, age, s)) continue;
      const n = Math.min(left, stack - s.qty);
      if (n > 0) {
        ops.push({ kind: "merge", id: s.id, qty: n });
        add(where, n);
        left -= n;
      }
    }
    if (where === HAND) {
      while (left > 0) {
        const n = Math.min(left, stack);
        ops.push({ kind: "new", where, x: 0, y: 0, rot: 0, qty: n });
        add(where, n);
        left -= n;
      }
      break;
    }
    const size = gridOf(w, where);
    const occ = occupancyOf(w, where);
    if (!size || !occ) continue;
    while (left > 0) {
      const spot = firstFit(occ, size, shape, rots);
      if (!spot) break;
      const n = Math.min(left, stack);
      mark(occ, size, shapeCells(shape, spot.rot), spot.x, spot.y, -1);
      ops.push({ kind: "new", where, ...spot, qty: n });
      add(where, n);
      left -= n;
    }
  }
  return { ops, placed, left };
}
function homeOrder(w, item, withHand) {
  const perishable = w.data.items[item]?.shelfLifeMinutes !== void 0;
  const auto = storageFacilityIds(w.data).filter((id) => {
    const st = storageOf(w, id);
    return st !== null && st.autoFill !== false && containerAccepts(w, id, item);
  });
  const byMult = (mult) => auto.filter((id) => mult(id) < 1).sort((a, b) => mult(a) - mult(b) || (a < b ? -1 : 1));
  const cold = perishable ? byMult((id) => containerSpoilMult(w, id)) : [];
  const safe = byMult((id) => containerBreachMult(w, id)).filter((id) => !cold.includes(id));
  return [...cold, ...safe, HOME, ...withHand ? [HAND] : []];
}
function arrangeLayout(w, where) {
  const { data: data2 } = w;
  const size = gridOf(w, where);
  if (!size) return null;
  const pieces = w.run.inventory.filter((s) => s.where === where).map((s) => ({ ...s }));
  pieces.sort((a, b) => a.id - b.id);
  const kept = [];
  const removed = [];
  for (const p of pieces) {
    let rest = p.qty;
    for (const k of kept) {
      if (rest === 0) break;
      if (!canStackOnto(data2, p.item, p.age, k)) continue;
      const n = Math.min(rest, itemStack(data2, p.item) - k.qty);
      if (n > 0) {
        k.qty += n;
        k.age = Math.max(k.age, p.age);
        rest -= n;
      }
    }
    if (rest > 0) kept.push({ ...p, qty: rest });
    else removed.push(p.id);
  }
  const cellCount = (s) => shapeCells(itemShape(data2, s.item), 0).length;
  kept.sort((a, b) => cellCount(b) - cellCount(a) || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0) || a.age - b.age || a.id - b.id);
  const occ = emptyOccupancy(size);
  for (const s of kept) {
    const shape = itemShape(data2, s.item);
    const spot = firstFit(occ, size, shape, distinctRotations(shape));
    if (!spot) return null;
    mark(occ, size, shapeCells(shape, spot.rot), spot.x, spot.y, s.id);
    Object.assign(s, spot);
  }
  return { layout: kept, removed };
}
function thresholdEffects(data2, stats) {
  const out = [];
  for (const e of Object.values(data2.effects)) {
    if (!e.when || e.when.length === 0) continue;
    if (e.when.every((c) => c.op === "<" ? stats[c.stat] < c.value : stats[c.stat] > c.value)) out.push(e.id);
  }
  return out.sort();
}
function activeEffectIds(w) {
  const set = new Set(thresholdEffects(w.data, w.run.stats));
  for (const e of w.run.effects) set.add(e.id);
  return [...set].sort();
}
function actionTimeMult(w) {
  let m = 1;
  for (const id of activeEffectIds(w)) m *= w.data.effects[id]?.actionTimeMult ?? 1;
  return m;
}
function actionMinutes(w, base) {
  if (base <= 0) return 0;
  return Math.max(1, Math.ceil(base * actionTimeMult(w) - 1e-9));
}
function charMods(w) {
  return w.data.characters[w.run.character]?.modifiers ?? {};
}
function priceBandMult(data2, minute) {
  let m = data2.config.priceBands[0]?.mult ?? 1;
  for (const b of data2.config.priceBands) if (b.fromMinute <= minute) m = b.mult;
  return m;
}
function stockKey(location, item) {
  return `${location}/${item}`;
}
function findStock(data2, location, item) {
  return data2.locations[location]?.stock?.find((s) => s.item === item) ?? null;
}
function stockLeft(w, location, item) {
  const s = findStock(w.data, location, item);
  if (!s) return 0;
  return Math.max(0, s.qty - (w.run.stockSold[stockKey(location, item)] ?? 0));
}
function unitPrice(w, stock) {
  const mult = priceBandMult(w.data, w.run.minute) * (charMods(w).priceMult ?? 1);
  return Math.ceil(stock.price * mult - 1e-9);
}
function vehiclePrice(w, v) {
  const mult = priceBandMult(w.data, w.run.minute) * (charMods(w).priceMult ?? 1);
  return Math.ceil(v.price * mult - 1e-9);
}
function travelBaseMinutes(w, from, to) {
  const base = w.data.locations[from]?.travelMinutes[to];
  if (base === void 0) return null;
  const mult = w.run.vehicle ? w.data.vehicles[w.run.vehicle]?.travelMult ?? 1 : 1;
  return Math.max(1, Math.ceil(base * mult - 1e-9));
}
function scavengeDangerChance(w, area) {
  const night = isNight(w.data, w.run.minute) ? w.data.config.nightDangerMult : 1;
  return Math.min(0.95, area.danger * night * (charMods(w).scavengeDangerMult ?? 1));
}
function isEnded(run) {
  return run.phase === "dead" || run.phase === "victory";
}

// src/sim/hand.ts
function leaveWithHand(ctx) {
  const { run, data: data2 } = ctx;
  const pieces = run.inventory.filter((s) => s.where === HAND).sort((a, b) => a.id - b.id);
  if (!pieces.length) return;
  run.inventory = run.inventory.filter((s) => s.where !== HAND);
  const placed = {};
  const lost = {};
  const atHome = run.location === data2.config.homeLocation;
  for (const s of pieces) {
    let left = s.qty;
    if (atHome) {
      const plan = planPlacement(ctx, s.item, s.qty, s.age, homeOrder(ctx, s.item, false));
      applyPlan(run, s.item, s.age, plan);
      addTotals(placed, s.item, s.qty - plan.left);
      left = plan.left;
    }
    addTotals(lost, s.item, left);
  }
  emit(ctx, { code: "hand_left", location: run.location, placed, lost });
}
function unloadTrunk(ctx) {
  const { run } = ctx;
  const stacks = run.inventory.filter((s) => s.where === TRUNK).sort((a, b) => a.id - b.id);
  if (!stacks.length) return;
  const items = inventoryTotals(run, [TRUNK]);
  const toHand = {};
  run.inventory = run.inventory.filter((s) => s.where !== TRUNK);
  for (const s of stacks) {
    const plan = planPlacement(ctx, s.item, s.qty, s.age, homeOrder(ctx, s.item, true));
    applyPlan(run, s.item, s.age, plan);
    addTotals(toHand, s.item, plan.placed[HAND] ?? 0);
  }
  emit(ctx, { code: "unloaded", items, auto: true, toHand });
}

// src/core/crops.ts
function syncCropSlots(ctx) {
  const n = cropSlotCount(ctx);
  while (ctx.run.crops.length < n) ctx.run.crops.push(null);
}

// src/sim/tick.ts
var EPS = 1e-9;
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function advance(ctx, minutes, activity) {
  let left = minutes;
  while (left > 0 && !isEnded(ctx.run)) {
    const dt = Math.min(left, ctx.data.config.tickMinutes, minutesToBoundary(ctx));
    stepBlock(ctx, dt, activity);
    left -= dt;
  }
}
function minutesToBoundary(ctx) {
  const { run, data: data2 } = ctx;
  const m = run.minute;
  const cands = [];
  if (run.phase === "stockpile") {
    cands.push(data2.config.stockpileMinutes - m);
  } else {
    cands.push(dayStartMinute(data2, baseDay(data2, m) + 1) - m);
    cands.push(victoryMinute(data2) - m);
    data2.hordes.forEach((h2, i) => {
      if (!run.hordesDone.includes(i)) cands.push(hordeMinute(data2, h2) - m);
    });
  }
  const positive = cands.filter((c) => c > 0);
  return positive.length ? Math.max(1, Math.min(...positive)) : DAY_MINUTES;
}
function stepBlock(ctx, dt, activity) {
  const { run, data: data2 } = ctx;
  const cfg = data2.config;
  const prevMinute = run.minute;
  const inBase = run.phase === "base";
  if (inBase) updatePower(ctx, dt);
  const weather = inBase ? currentWeather(ctx) : null;
  const ids = activeEffectIds(ctx);
  const mods = charMods(ctx);
  for (const stat of STAT_IDS) {
    let rate = stat === "energy" ? cfg.activityEnergy[activity] : cfg.baseRates[stat];
    rate += weather?.perMinute?.[stat] ?? 0;
    for (const id of ids) rate += data2.effects[id]?.perMinute[stat] ?? 0;
    if (rate < 0) {
      rate *= mods.statDecayMult ?? 1;
      if (activity === "sleep" && stat !== "energy") rate *= cfg.sleepDecayMult;
    }
    run.stats[stat] = clamp(run.stats[stat] + rate * dt, 0, cfg.statMax);
  }
  const mults = /* @__PURE__ */ new Map();
  const multOf = (where) => {
    if (!mults.has(where)) mults.set(where, containerSpoilMult(ctx, where));
    return mults.get(where);
  };
  for (const s of run.inventory) {
    const shelf = data2.items[s.item]?.shelfLifeMinutes;
    if (shelf === void 0) continue;
    s.age += dt * multOf(s.where);
    if (s.age < shelf) continue;
    const [fx, fy] = shapeCells(itemShape(data2, s.item), s.rot)[0];
    emit(ctx, { code: "spoiled", item: s.item, qty: s.qty });
    Object.assign(s, { item: cfg.spoiledItem, age: 0, rot: 0, x: s.x + fx, y: s.y + fy });
  }
  if (run.effects.length) {
    const still = [];
    const ended2 = [];
    for (const e of run.effects) {
      e.remaining -= dt;
      (e.remaining > 0 ? still : ended2).push(e);
    }
    run.effects = still;
    for (const e of ended2) emit(ctx, { code: "effect_ended", effect: e.id });
  }
  run.minute += dt;
  const now = thresholdEffects(data2, run.stats);
  for (const id of now) if (!run.thresholds.includes(id)) emit(ctx, { code: "effect_started", effect: id });
  for (const id of run.thresholds) if (!now.includes(id)) emit(ctx, { code: "effect_ended", effect: id });
  run.thresholds = now;
  run.crops.forEach((slot, i) => {
    if (!slot) return;
    const ready = slot.plantedAt + (data2.crops[slot.crop]?.growMinutes ?? Infinity);
    if (prevMinute < ready && ready <= run.minute) emit(ctx, { code: "crop_ready", crop: slot.crop, slot: i });
  });
  if (run.phase === "stockpile" && run.minute >= cfg.stockpileMinutes) transition(ctx);
  if (run.phase === "base") {
    const sinceStart = run.minute - cfg.stockpileMinutes;
    if (sinceStart % DAY_MINUTES === 0 && run.minute < victoryMinute(data2)) {
      const day = baseDay(data2, run.minute);
      emit(ctx, { code: "day_start", day, weather: weatherForDay(data2, ctx.meta, day).id });
      if (!run.seen.weatherDays.includes(day)) run.seen.weatherDays.push(day);
    }
    for (let i = 0; i < data2.hordes.length && run.phase === "base"; i++) {
      const h2 = data2.hordes[i];
      if (hordeMinute(data2, h2) <= run.minute && !run.hordesDone.includes(i)) resolveHorde(ctx, i);
    }
  }
  checkEnd(ctx);
}
function updatePower(ctx, dt) {
  const { run, data: data2 } = ctx;
  if (powerState(ctx) === "generator") {
    let perHour = 0;
    for (const b of builtLevels(ctx)) if (b.def.providesPower) perHour += b.def.fuelPerHour ?? 0;
    run.fuelLeft -= perHour * dt / 60;
    const where = accessibleContainers(ctx);
    while (run.fuelLeft <= EPS && countItem(run, data2.config.fuelItem, where) > 0) {
      removeItem(run, data2.config.fuelItem, 1, where);
      run.fuelLeft += 1;
    }
    if (run.fuelLeft <= EPS) run.fuelLeft = 0;
  }
  const p = powerState(ctx);
  if (p !== run.power) {
    run.power = p;
    emit(ctx, { code: "power_changed", power: p });
  }
}
function transition(ctx) {
  const { run, data: data2 } = ctx;
  const cfg = data2.config;
  run.phase = "base";
  emit(ctx, { code: "disaster_begins" });
  if (run.location !== cfg.homeLocation) {
    leaveWithHand(ctx);
    const lostItems = loseFraction(ctx, (where) => where === BACKPACK || where === TRUNK ? cfg.awayPenalty.lossFraction : 0);
    run.stats.health = Math.max(0, run.stats.health - cfg.awayPenalty.healthLoss);
    run.location = cfg.homeLocation;
    emit(ctx, { code: "away_penalty", lostItems, healthLoss: cfg.awayPenalty.healthLoss });
  }
  unloadTrunk(ctx);
  syncCropSlots(ctx);
  const p = powerState(ctx);
  if (p !== run.power) {
    run.power = p;
    emit(ctx, { code: "power_changed", power: p });
  }
  if (run.stats.health <= 0) checkEnd(ctx, "away_from_home");
}
function loseFraction(ctx, fractionOf) {
  const lost = {};
  const byItem = /* @__PURE__ */ new Map();
  for (const s of ctx.run.inventory) {
    const f = fractionOf(s.where);
    if (f <= 0) continue;
    if (!byItem.has(s.item)) byItem.set(s.item, []);
    byItem.get(s.item).push({ s, f });
  }
  for (const [item, list2] of byItem) {
    let loss = Math.floor(list2.reduce((sum, x) => sum + x.s.qty * x.f, 0) + EPS);
    if (loss <= 0) continue;
    lost[item] = loss;
    list2.sort((a, b) => b.f - a.f || a.s.id - b.s.id);
    for (const { s } of list2) {
      const take = Math.min(s.qty, loss);
      s.qty -= take;
      loss -= take;
      if (loss === 0) break;
    }
  }
  ctx.run.inventory = ctx.run.inventory.filter((s) => s.qty > 0);
  return lost;
}
function resolveHorde(ctx, index) {
  const { run, data: data2 } = ctx;
  const h2 = data2.hordes[index];
  const defense = totalDefense(ctx);
  run.hordesDone.push(index);
  if (!run.seen.hordeIndices.includes(index)) run.seen.hordeIndices.push(index);
  emit(ctx, { code: "horde_arrives", day: h2.day, strength: h2.strength, defense });
  if (defense >= h2.strength) {
    emit(ctx, { code: "horde_repelled", day: h2.day });
    return;
  }
  const damage = Math.ceil((h2.strength - defense) * data2.config.breach.damagePerPoint - EPS);
  run.stats.health = Math.max(0, run.stats.health - damage);
  const lostItems = loseFraction(ctx, (where) => data2.config.breach.lossFraction * containerBreachMult(ctx, where));
  emit(ctx, { code: "horde_breach", day: h2.day, damage, lostItems });
  if (run.stats.health <= 0) checkEnd(ctx, "horde");
}
function checkEnd(ctx, causeHint) {
  const { run, data: data2 } = ctx;
  if (run.ending || isEnded(run)) return true;
  if (run.stats.health <= 0) {
    const cause = causeHint ?? deathCauseFromEffects(ctx);
    const day = baseDay(data2, run.minute);
    run.phase = "dead";
    run.ending = { kind: "dead", cause, day, settled: false };
    emit(ctx, { code: "death", cause, day });
    return true;
  }
  if (run.phase === "base" && run.minute >= victoryMinute(data2)) {
    run.phase = "victory";
    run.ending = { kind: "victory", cause: "survived", day: data2.config.targetDays, settled: false };
    emit(ctx, { code: "victory", day: data2.config.targetDays });
    return true;
  }
  return false;
}
function deathCauseFromEffects(ctx) {
  let worst = 0;
  let cause = "unknown";
  for (const id of activeEffectIds(ctx)) {
    const e = ctx.data.effects[id];
    const hp = e?.perMinute.health ?? 0;
    if (e && hp < worst) {
      worst = hp;
      cause = e.deathCause ?? "unknown";
    }
  }
  return cause;
}

// src/sim/actions/util.ts
function fitsStockpile(ctx, minutes) {
  if (ctx.run.phase !== "stockpile") return true;
  return ctx.run.minute + minutes < ctx.data.config.stockpileMinutes;
}
function isPositiveInt(n) {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}
function ended(ctx) {
  return isEnded(ctx.run);
}
function carryOrder(ctx) {
  return accessibleContainers(ctx).filter((c) => c === BACKPACK || c === TRUNK);
}
function stowNew(ctx, item, qty, age, toHand) {
  const atHome = ctx.run.location === ctx.data.config.homeLocation;
  const order = atHome ? homeOrder(ctx, item, true) : [...carryOrder(ctx), HAND];
  const plan = planPlacement(ctx, item, qty, age, order);
  applyPlan(ctx.run, item, age, plan);
  const n = plan.placed[HAND] ?? 0;
  addTotals(toHand, item, n);
  return n;
}
function emitToHand(ctx, toHand) {
  if (Object.keys(toHand).length) emit(ctx, { code: "to_hand", items: toHand });
}

// src/sim/actions/market.ts
function travel(ctx, a) {
  const { run, data: data2 } = ctx;
  if (typeof a.to !== "string") return "invalid_argument";
  if (!data2.locations[a.to]) return "unknown_id";
  if (a.to === run.location) return "already_here";
  const base = travelBaseMinutes(ctx, run.location, a.to);
  if (base === null) return "no_route";
  const minutes = actionMinutes(ctx, base);
  if (!fitsStockpile(ctx, minutes)) return "not_enough_time";
  leaveWithHand(ctx);
  run.location = a.to;
  advance(ctx, minutes, "travel");
  if (ended(ctx)) return null;
  emit(ctx, { code: "arrived", location: a.to });
  if (a.to === data2.config.homeLocation) unloadTrunk(ctx);
  return null;
}
function buy(ctx, a) {
  const { run, data: data2 } = ctx;
  if (!isPositiveInt(a.qty) || typeof a.item !== "string") return "invalid_argument";
  if (!data2.items[a.item]) return "unknown_id";
  if (!data2.locations[run.location]?.stock) return "not_at_shop";
  const stock = findStock(data2, run.location, a.item);
  if (!stock) return "not_in_stock";
  if (a.qty > stockLeft(ctx, run.location, a.item)) return "not_in_stock";
  const cost = unitPrice(ctx, stock) * a.qty;
  if (run.money < cost) return "not_enough_money";
  const minutes = actionMinutes(ctx, data2.config.buyMinutes);
  if (!fitsStockpile(ctx, minutes)) return "not_enough_time";
  run.money -= cost;
  const key = stockKey(run.location, a.item);
  run.stockSold[key] = (run.stockSold[key] ?? 0) + a.qty;
  const toHand = {};
  stowNew(ctx, a.item, a.qty, 0, toHand);
  advance(ctx, minutes, "idle");
  if (ended(ctx)) return null;
  emit(ctx, { code: "bought", item: a.item, qty: a.qty, cost });
  emitToHand(ctx, toHand);
  return null;
}
function buyVehicle(ctx, a) {
  const { run, data: data2 } = ctx;
  if (typeof a.vehicle !== "string") return "invalid_argument";
  const v = data2.vehicles[a.vehicle];
  if (!v) return "unknown_id";
  if (!(data2.locations[run.location]?.vehicles ?? []).includes(v.id)) return "not_in_stock";
  if (run.vehicle !== null) return "already_done";
  const cost = vehiclePrice(ctx, v);
  if (run.money < cost) return "not_enough_money";
  const minutes = actionMinutes(ctx, data2.config.buyMinutes);
  if (!fitsStockpile(ctx, minutes)) return "not_enough_time";
  run.money -= cost;
  run.vehicle = v.id;
  advance(ctx, minutes, "idle");
  if (ended(ctx)) return null;
  emit(ctx, { code: "vehicle_bought", vehicle: v.id, cost });
  return null;
}
function startDisaster(ctx, _a) {
  advance(ctx, ctx.data.config.stockpileMinutes - ctx.run.minute, "idle");
  return null;
}

// src/sim/actions/items.ts
function use(ctx, a) {
  const { run, data: data2 } = ctx;
  if (typeof a.item !== "string") return "invalid_argument";
  const def = data2.items[a.item];
  if (!def) return "unknown_id";
  if (!def.use) return "not_usable";
  const where = accessibleContainers(ctx);
  if (countItem(run, a.item, where) < 1) return "missing_items";
  const u = def.use;
  const minutes = actionMinutes(ctx, u.minutes);
  if (!fitsStockpile(ctx, minutes)) return "not_enough_time";
  removeItem(run, a.item, 1, where);
  for (const stat of STAT_IDS) {
    const d = u.stats?.[stat];
    if (d) run.stats[stat] = Math.min(data2.config.statMax, Math.max(0, run.stats[stat] + d));
  }
  for (const id of u.applyEffects ?? []) {
    const e = data2.effects[id];
    if (!e || e.durationMinutes === void 0) continue;
    const wasActive = activeEffectIds(ctx).includes(id);
    const existing = run.effects.find((x) => x.id === id);
    if (existing) existing.remaining = e.durationMinutes;
    else run.effects.push({ id, remaining: e.durationMinutes });
    if (!wasActive) emit(ctx, { code: "effect_started", effect: id });
  }
  for (const id of u.removeEffects ?? []) {
    const before = run.effects.length;
    run.effects = run.effects.filter((x) => x.id !== id);
    if (run.effects.length < before) emit(ctx, { code: "effect_ended", effect: id });
  }
  advance(ctx, minutes, "idle");
  if (ended(ctx)) return null;
  emit(ctx, { code: "used", item: a.item });
  return null;
}
function wait(ctx, a) {
  if (!isPositiveInt(a.minutes) || a.minutes > 1440) return "invalid_argument";
  if (!fitsStockpile(ctx, a.minutes)) return "not_enough_time";
  advance(ctx, a.minutes, "idle");
  if (ended(ctx)) return null;
  emit(ctx, { code: "waited", minutes: a.minutes });
  return null;
}
function sleep(ctx, a) {
  if (!isPositiveInt(a.hours) || a.hours > 24) return "invalid_argument";
  advance(ctx, a.hours * 60, "sleep");
  if (ended(ctx)) return null;
  emit(ctx, { code: "slept", hours: a.hours });
  return null;
}

// src/sim/actions/storage.ts
function place(ctx, a) {
  const { run, data: data2 } = ctx;
  if (!Number.isInteger(a.piece)) return "invalid_argument";
  const src = run.inventory.find((s) => s.id === a.piece);
  if (!src) return "unknown_id";
  const qty = a.qty ?? src.qty;
  if (!isPositiveInt(qty) || qty > src.qty) return "invalid_argument";
  if (a.to !== HAND && (!Number.isInteger(a.x) || !Number.isInteger(a.y) || !ROTATIONS.includes(a.rot))) return "invalid_argument";
  const bad = containerError(ctx, src.where) ?? containerError(ctx, a.to);
  if (bad) return bad;
  if (!containerAccepts(ctx, a.to, src.item)) return "not_accepted";
  const whole = qty === src.qty;
  const from = src.where;
  if (a.to === HAND) {
    if (from === HAND) return "invalid_argument";
    if (whole) Object.assign(src, { where: HAND, x: 0, y: 0, rot: 0 });
    else {
      src.qty -= qty;
      newPiece(run, { item: src.item, qty, age: src.age, where: HAND, x: 0, y: 0, rot: 0 });
    }
    emit(ctx, { code: "moved", item: src.item, qty, from, to: HAND });
    return null;
  }
  const size = gridOf(ctx, a.to);
  const cells = shapeCells(itemShape(data2, src.item), a.rot);
  if (!inBounds(size, cells, a.x, a.y)) return "out_of_bounds";
  const occ = occupancyOf(ctx, a.to, whole ? src.id : 0);
  const blockers = blockersAt(occ, size, cells, a.x, a.y);
  if (blockers.length === 0) {
    if (whole) Object.assign(src, { where: a.to, x: a.x, y: a.y, rot: a.rot });
    else {
      src.qty -= qty;
      newPiece(run, { item: src.item, qty, age: src.age, where: a.to, x: a.x, y: a.y, rot: a.rot });
    }
  } else {
    const target = blockers.length === 1 ? run.inventory.find((s) => s.id === blockers[0]) : void 0;
    if (!target || target.id === src.id || !canStackOnto(data2, src.item, src.age, target)) return "blocked";
    if (target.qty + qty > itemStack(data2, src.item)) return "no_space";
    takeFromPiece(run, src.id, qty);
    target.qty += qty;
    target.age = Math.max(target.age, src.age);
  }
  if (from !== a.to) emit(ctx, { code: "moved", item: src.item, qty, from, to: a.to });
  return null;
}
function discard(ctx, a) {
  const { run } = ctx;
  if (!Number.isInteger(a.piece)) return "invalid_argument";
  const src = run.inventory.find((s) => s.id === a.piece);
  if (!src) return "unknown_id";
  const qty = a.qty ?? src.qty;
  if (!isPositiveInt(qty) || qty > src.qty) return "invalid_argument";
  const bad = containerError(ctx, src.where);
  if (bad) return bad;
  takeFromPiece(run, src.id, qty);
  emit(ctx, { code: "discarded", item: src.item, qty });
  return null;
}
function unloadAll(ctx, _a) {
  const { run, data: data2 } = ctx;
  if (run.location !== data2.config.homeLocation) return "not_at_home";
  const carried = (where) => where === BACKPACK || where === TRUNK;
  const pieces = run.inventory.filter((s) => carried(s.where)).sort((x, y) => x.id - y.id);
  if (!pieces.length) return "missing_items";
  const items = {};
  const toHand = {};
  run.inventory = run.inventory.filter((s) => !carried(s.where));
  for (const s of pieces) {
    const plan = planPlacement(ctx, s.item, s.qty, s.age, homeOrder(ctx, s.item, true));
    applyPlan(run, s.item, s.age, plan);
    addTotals(items, s.item, s.qty);
    addTotals(toHand, s.item, plan.placed[HAND] ?? 0);
  }
  emit(ctx, { code: "unloaded", items, auto: false, toHand });
  return null;
}
function stowHand(ctx, _a) {
  const { run, data: data2 } = ctx;
  const pieces = run.inventory.filter((s) => s.where === HAND).sort((x, y) => x.id - y.id);
  if (!pieces.length) return "missing_items";
  const atHome = run.location === data2.config.homeLocation;
  const items = {};
  for (const s of pieces) {
    const order = atHome ? homeOrder(ctx, s.item, false) : carryOrder(ctx);
    run.inventory = run.inventory.filter((x) => x !== s);
    const plan = planPlacement(ctx, s.item, s.qty, s.age, order);
    applyPlan(run, s.item, s.age, plan);
    addTotals(items, s.item, s.qty - plan.left);
    if (plan.left > 0) run.inventory.push({ ...s, qty: plan.left });
  }
  if (!Object.keys(items).length) return "no_space";
  emit(ctx, { code: "stowed", items });
  return null;
}
function discardHand(ctx, _a) {
  const { run } = ctx;
  const pieces = run.inventory.filter((s) => s.where === HAND);
  if (!pieces.length) return "missing_items";
  run.inventory = run.inventory.filter((s) => s.where !== HAND);
  const items = {};
  for (const s of pieces) addTotals(items, s.item, s.qty);
  for (const [item, qty] of Object.entries(items)) emit(ctx, { code: "discarded", item, qty });
  return null;
}
function autoArrange(ctx, a) {
  const { run } = ctx;
  if (a.where === HAND) return "invalid_argument";
  const bad = containerError(ctx, a.where);
  if (bad) return bad;
  if (!run.inventory.some((s) => s.where === a.where)) return "missing_items";
  const result = arrangeLayout(ctx, a.where);
  if (!result) return "no_space";
  run.inventory = [...run.inventory.filter((s) => s.where !== a.where), ...result.layout];
  emit(ctx, { code: "arranged", where: a.where });
  return null;
}

// src/sim/actions/home.ts
function storeAtHome(ctx, item, qty, toHand) {
  stowNew(ctx, item, qty, 0, toHand);
}
function cook(ctx, a) {
  const { run, data: data2 } = ctx;
  if (typeof a.recipe !== "string") return "invalid_argument";
  const r = data2.recipes[a.recipe];
  if (!r) return "unknown_id";
  if (r.requiresFacility && facilityLevel(run, r.requiresFacility) < 1) return "missing_facility";
  const where = accessibleContainers(ctx);
  if (!hasItems(run, r.inputs, where)) return "missing_items";
  const minutes = actionMinutes(ctx, r.minutes);
  removeItems(run, r.inputs, where);
  advance(ctx, minutes, "work");
  if (ended(ctx)) return null;
  const toHand = {};
  for (const [item, qty] of Object.entries(r.outputs)) if (qty > 0) storeAtHome(ctx, item, qty, toHand);
  emit(ctx, { code: "cooked", recipe: r.id });
  emitToHand(ctx, toHand);
  return null;
}
function plant(ctx, a) {
  const { run, data: data2 } = ctx;
  if (typeof a.crop !== "string") return "invalid_argument";
  const c = data2.crops[a.crop];
  if (!c) return "unknown_id";
  const where = accessibleContainers(ctx);
  if (countItem(run, c.seedItem, where) < 1) return "missing_items";
  if (run.crops.indexOf(null) === -1) return "no_free_slot";
  const minutes = actionMinutes(ctx, data2.config.plantMinutes);
  removeItem(run, c.seedItem, 1, where);
  advance(ctx, minutes, "work");
  if (ended(ctx)) return null;
  const slot = run.crops.indexOf(null);
  if (slot === -1) return "no_free_slot";
  run.crops[slot] = { crop: c.id, plantedAt: run.minute };
  emit(ctx, { code: "planted", crop: c.id, slot });
  return null;
}
function harvest(ctx, a) {
  const { run, data: data2 } = ctx;
  if (!Number.isInteger(a.slot) || a.slot < 0 || a.slot >= run.crops.length) return "invalid_argument";
  const s = run.crops[a.slot];
  if (!s) return "slot_empty";
  const c = data2.crops[s.crop];
  if (!c) return "unknown_id";
  if (run.minute < s.plantedAt + c.growMinutes) return "crop_not_ready";
  const minutes = actionMinutes(ctx, data2.config.harvestMinutes);
  advance(ctx, minutes, "work");
  if (ended(ctx)) return null;
  run.crops[a.slot] = null;
  const yields = {};
  const toHand = {};
  for (const [item, qty] of Object.entries(c.yield)) {
    if (qty > 0) {
      storeAtHome(ctx, item, qty, toHand);
      yields[item] = qty;
    }
  }
  emit(ctx, { code: "harvested", crop: c.id, yields });
  emitToHand(ctx, toHand);
  return null;
}
function build(ctx, a) {
  const { run, data: data2 } = ctx;
  if (typeof a.facility !== "string") return "invalid_argument";
  const f = data2.facilities[a.facility];
  if (!f) return "unknown_id";
  const next = facilityLevel(run, a.facility) + 1;
  if (next > f.levels.length) return "max_level";
  const lv = f.levels[next - 1];
  const where = accessibleContainers(ctx);
  if (!hasItems(run, lv.cost, where)) return "missing_items";
  const minutes = actionMinutes(ctx, lv.buildMinutes);
  removeItems(run, lv.cost, where);
  advance(ctx, minutes, "work");
  if (ended(ctx)) return null;
  run.facilities[a.facility] = next;
  syncCropSlots(ctx);
  emit(ctx, { code: "built", facility: a.facility, level: next });
  return null;
}

// src/sim/actions/scavenge.ts
function scavenge(ctx, a) {
  const { run, data: data2 } = ctx;
  if (typeof a.area !== "string") return "invalid_argument";
  const area = data2.areas[a.area];
  if (!area) return "unknown_id";
  if ((area.unlockDay ?? 1) > baseDay(data2, run.minute)) return "area_locked";
  if (currentWeather(ctx)?.blocksScavenge) return "weather_blocked";
  const chance = scavengeDangerChance(ctx, area);
  const minutes = actionMinutes(ctx, area.minutes);
  leaveWithHand(ctx);
  advance(ctx, minutes, "travel");
  if (ended(ctx)) return null;
  if (rand(ctx) < chance) {
    const damage = randInt(ctx, area.injury[0], area.injury[1]);
    run.stats.health = Math.max(0, run.stats.health - damage);
    emit(ctx, { code: "scavenge_injury", area: area.id, damage });
    if (checkEnd(ctx, "injury")) return null;
  }
  const draws = [];
  const rolls = randInt(ctx, area.rolls[0], area.rolls[1]);
  for (let i = 0; i < rolls; i++) {
    const entry = pickWeighted(ctx, area.loot, (l) => l.weight);
    draws.push({ item: entry.item, qty: randInt(ctx, entry.qty[0], entry.qty[1]) });
  }
  const loot = {};
  const left = {};
  for (const d of draws) {
    const plan = planPlacement(ctx, d.item, d.qty, 0, [BACKPACK]);
    applyPlan(run, d.item, 0, plan);
    addTotals(loot, d.item, d.qty - plan.left);
    addTotals(left, d.item, plan.left);
  }
  emit(ctx, { code: "scavenged", area: area.id, loot });
  if (Object.keys(left).length) emit(ctx, { code: "loot_left_behind", area: area.id, items: left });
  return null;
}

// src/sim/meta.ts
function newMeta(worldSeed) {
  return {
    worldSeed,
    loops: 0,
    points: 0,
    perks: [],
    knowledge: { weatherDays: [], hordeIndices: [] },
    history: [],
    bestDay: 0
  };
}
function startRun(data2, meta, character, seed) {
  const cfg = data2.config;
  const ch = data2.characters[character];
  if (!ch) throw new Error(`startRun: unknown character "${character}"`);
  let money = ch.startMoney;
  const stats = { ...cfg.startStats };
  const run = {
    loop: meta.loops + 1,
    character,
    rng: seed | 0,
    minute: 0,
    phase: "stockpile",
    location: cfg.homeLocation,
    money: 0,
    stats,
    effects: [],
    thresholds: [],
    inventory: [],
    nextPieceId: 1,
    vehicle: null,
    facilities: {},
    crops: [],
    stockSold: {},
    hordesDone: [],
    power: "grid",
    fuelLeft: 0,
    seen: { weatherDays: [], hordeIndices: [] },
    ending: null
  };
  const w = { data: data2, meta, run };
  const give = (item, qty) => qty > 0 && applyPlan(run, item, 0, planPlacement(w, item, qty, 0, homeOrder(w, item, true)));
  for (const [item, qty] of Object.entries(ch.startItems)) give(item, qty);
  for (const id of meta.perks) {
    const p = data2.perks[id];
    if (!p) continue;
    money += p.effect.startMoney ?? 0;
    for (const stat of STAT_IDS) stats[stat] += p.effect.startStats?.[stat] ?? 0;
    for (const [item, qty] of Object.entries(p.effect.startItems ?? {})) give(item, qty);
  }
  for (const stat of STAT_IDS) stats[stat] = Math.min(cfg.statMax, Math.max(0, stats[stat]));
  run.money = money;
  run.thresholds = thresholdEffects(data2, stats);
  return run;
}
var union = (a, b) => [.../* @__PURE__ */ new Set([...a, ...b])].sort((x, y) => x - y);
function settleRun(ctx) {
  const { run, meta, data: data2 } = ctx;
  const end = run.ending;
  if (!end || end.settled) return;
  const pts = data2.config.points;
  const pointsEarned = pts.perDay * end.day + (end.kind === "victory" ? pts.victoryBonus : 0);
  meta.loops += 1;
  meta.points += pointsEarned;
  meta.bestDay = Math.max(meta.bestDay, end.day);
  meta.history.push({
    loop: run.loop,
    character: run.character,
    days: end.day,
    kind: end.kind,
    cause: end.cause,
    pointsEarned
  });
  meta.knowledge.weatherDays = union(meta.knowledge.weatherDays, run.seen.weatherDays);
  meta.knowledge.hordeIndices = union(meta.knowledge.hordeIndices, run.seen.hordeIndices);
  end.settled = true;
  emit(ctx, { code: "run_settled", pointsEarned, kind: end.kind });
}
function buyPerk(ctx, a) {
  const { meta, data: data2 } = ctx;
  if (typeof a.perk !== "string") return "invalid_argument";
  const p = data2.perks[a.perk];
  if (!p) return "unknown_id";
  if (meta.perks.includes(p.id)) return "perk_owned";
  if (meta.points < p.cost) return "not_enough_points";
  meta.points -= p.cost;
  meta.perks.push(p.id);
  emit(ctx, { code: "perk_bought", perk: p.id });
  return null;
}
function rebirth(ctx, a) {
  const { meta, data: data2 } = ctx;
  if (typeof a.character !== "string") return "invalid_argument";
  if (!data2.characters[a.character]) return "unknown_id";
  if (ctx.run.ending?.settled !== true) return "wrong_phase";
  const loop = meta.loops + 1;
  ctx.run = startRun(data2, meta, a.character, hashSeed(meta.worldSeed, loop, 81));
  emit(ctx, { code: "rebirth", loop: ctx.run.loop, character: a.character });
  return null;
}

// src/sim/actions/index.ts
var STORAGE_ACTIONS = ["place", "discard", "unloadAll", "stowHand", "discardHand", "autoArrange"];
var PHASE_ACTIONS = {
  stockpile: ["travel", "buy", "buyVehicle", "startDisaster", "use", ...STORAGE_ACTIONS, "wait"],
  base: ["use", ...STORAGE_ACTIONS, "wait", "sleep", "cook", "plant", "harvest", "build", "scavenge"],
  dead: ["buyPerk", "rebirth"],
  victory: ["buyPerk", "rebirth"]
};
function applyAction(ctx, action) {
  if (!PHASE_ACTIONS[ctx.run.phase].includes(action.type)) return "wrong_phase";
  switch (action.type) {
    case "travel":
      return travel(ctx, action);
    case "buy":
      return buy(ctx, action);
    case "buyVehicle":
      return buyVehicle(ctx, action);
    case "startDisaster":
      return startDisaster(ctx, action);
    case "place":
      return place(ctx, action);
    case "unloadAll":
      return unloadAll(ctx, action);
    case "stowHand":
      return stowHand(ctx, action);
    case "discardHand":
      return discardHand(ctx, action);
    case "autoArrange":
      return autoArrange(ctx, action);
    case "use":
      return use(ctx, action);
    case "discard":
      return discard(ctx, action);
    case "wait":
      return wait(ctx, action);
    case "sleep":
      return sleep(ctx, action);
    case "cook":
      return cook(ctx, action);
    case "plant":
      return plant(ctx, action);
    case "harvest":
      return harvest(ctx, action);
    case "build":
      return build(ctx, action);
    case "scavenge":
      return scavenge(ctx, action);
    case "buyPerk":
      return buyPerk(ctx, action);
    case "rebirth":
      return rebirth(ctx, action);
  }
}

// src/sim/engine.ts
function newSession(data2, opts) {
  const meta = newMeta(opts.worldSeed);
  const run = startRun(data2, meta, opts.character, hashSeed(meta.worldSeed, meta.loops + 1, 81));
  return { meta, run };
}
function step(data2, session2, action) {
  const clone = structuredClone(session2);
  const ctx = makeCtx(data2, clone);
  const error = applyAction(ctx, action);
  if (error) return { ok: false, error };
  if (ctx.run.ending && !ctx.run.ending.settled) settleRun(ctx);
  return { ok: true, session: { meta: ctx.meta, run: ctx.run }, events: ctx.events };
}
var byId = (xs) => xs.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function candidateActions(data2, session2) {
  const { run } = session2;
  const cfg = data2.config;
  const w = { data: data2, meta: session2.meta, run };
  const out = [];
  const where = accessibleContainers(w);
  const usableItems = [...new Set(run.inventory.filter((s) => where.includes(s.where)).map((s) => s.item))].filter((id) => data2.items[id]?.use).sort();
  if (run.phase === "stockpile") {
    const loc = data2.locations[run.location];
    for (const to of Object.keys(loc?.travelMinutes ?? {}).sort()) out.push({ type: "travel", to });
    for (const vehicle of [...loc?.vehicles ?? []].sort()) out.push({ type: "buyVehicle", vehicle });
    for (const s of loc?.stock ?? [])
      for (const qty of cfg.buyQuantities) out.push({ type: "buy", item: s.item, qty });
    out.push({ type: "startDisaster" });
  }
  if (run.phase === "stockpile" || run.phase === "base") {
    for (const item of usableItems) out.push({ type: "use", item });
    if (where.includes(HOME)) out.push({ type: "unloadAll" });
    if (run.inventory.some((s) => s.where === HAND)) out.push({ type: "stowHand" }, { type: "discardHand" });
    for (const c of where) if (c !== HAND && run.inventory.some((s) => s.where === c)) out.push({ type: "autoArrange", where: c });
    for (const from of where) {
      const firstOfItem = /* @__PURE__ */ new Map();
      for (const s of run.inventory) if (s.where === from && !firstOfItem.has(s.item)) firstOfItem.set(s.item, s);
      for (const item of [...firstOfItem.keys()].sort()) {
        const s = firstOfItem.get(item);
        out.push({ type: "discard", piece: s.id });
        for (const to of where) {
          if (to === from) continue;
          const a = quickPlace(w, s, to);
          if (a) out.push(a);
        }
      }
    }
    for (const minutes of cfg.waitMinutesOptions) out.push({ type: "wait", minutes });
  }
  if (run.phase === "base") {
    for (const hours of cfg.sleepHoursOptions) out.push({ type: "sleep", hours });
    for (const r of byId(Object.values(data2.recipes))) out.push({ type: "cook", recipe: r.id });
    for (const c of byId(Object.values(data2.crops))) out.push({ type: "plant", crop: c.id });
    run.crops.forEach((_, slot) => out.push({ type: "harvest", slot }));
    for (const f of byId(Object.values(data2.facilities))) out.push({ type: "build", facility: f.id });
    for (const a of byId(Object.values(data2.areas))) out.push({ type: "scavenge", area: a.id });
  }
  if (run.phase === "dead" || run.phase === "victory") {
    for (const p of byId(Object.values(data2.perks))) out.push({ type: "buyPerk", perk: p.id });
    for (const c of byId(Object.values(data2.characters))) out.push({ type: "rebirth", character: c.id });
  }
  return out;
}
function quickPlace(w, s, to) {
  if (to === HAND) return { type: "place", piece: s.id, to, x: 0, y: 0, rot: 0 };
  if (!containerAccepts(w, to, s.item)) return null;
  const stack = itemStack(w.data, s.item);
  const onto = w.run.inventory.find((t) => t.where === to && t.id !== s.id && canStackOnto(w.data, s.item, s.age, t) && t.qty + s.qty <= stack);
  if (onto) return { type: "place", piece: s.id, to, x: onto.x, y: onto.y, rot: onto.rot };
  const size = gridOf(w, to);
  const occ = occupancyOf(w, to, s.id);
  if (!size || !occ) return null;
  const shape = itemShape(w.data, s.item);
  const spot = firstFit(occ, size, shape, distinctRotations(shape));
  return spot ? { type: "place", piece: s.id, to, ...spot } : null;
}
function checkAction(data2, session2, action) {
  const r = step(data2, session2, action);
  return r.ok ? { action, enabled: true } : { action, enabled: false, reason: r.error };
}
function legalActions(data2, session2) {
  return candidateActions(data2, session2).map((action) => checkAction(data2, session2, action));
}

// src/sim/save.ts
var SAVE_VERSION = 3;
var asObj = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : null;
function v1ToV2(s) {
  const run = asObj(s.run);
  if (!run) return s;
  const home = run.location === "home" || run.phase !== "stockpile";
  const where = home ? HOME : BACKPACK;
  if (Array.isArray(run.inventory)) run.inventory = run.inventory.map((st) => ({ ...asObj(st) ?? {}, where }));
  run.vehicle = null;
  return s;
}
function v2ToV3(s, data2) {
  const run = asObj(s.run);
  const meta = asObj(s.meta);
  if (!run || !meta || !Array.isArray(run.inventory)) return s;
  const old = run.inventory;
  run.inventory = [];
  run.nextPieceId = 1;
  const w = { data: data2, meta, run };
  for (const st of old) {
    if (!st || typeof st.item !== "string" || !(st.qty > 0)) continue;
    const homeSide = st.where !== BACKPACK && st.where !== "trunk";
    const order = homeSide ? [st.where, ...homeOrder(w, st.item, false).filter((c) => c !== st.where)] : [st.where];
    applyPlan(run, st.item, st.age, planPlacement(w, st.item, st.qty, st.age, [...order, HAND]));
  }
  return s;
}
var MIGRATIONS = { 1: v1ToV2, 2: v2ToV3 };
function serializeSession(session2) {
  return JSON.stringify({ v: SAVE_VERSION, session: session2 });
}
function migrateSession(data2, session2, from, to = SAVE_VERSION, migrations = MIGRATIONS) {
  let s = session2;
  for (let v = from; v < to; v++) {
    const m = migrations[v];
    if (!m) return null;
    try {
      s = m(structuredClone(s), data2);
    } catch {
      return null;
    }
    if (!s || typeof s !== "object") return null;
  }
  return s;
}
function deserializeSession(data2, text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed;
  const v = obj.v;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > SAVE_VERSION) return null;
  if (!obj.session || typeof obj.session !== "object" || Array.isArray(obj.session)) return null;
  const migrated = migrateSession(data2, obj.session, v);
  return migrated && looksLikeSession(migrated) ? migrated : null;
}
function looksLikeSession(s) {
  const meta = s.meta;
  const run = s.run;
  if (!meta || typeof meta !== "object" || !run || typeof run !== "object") return false;
  return typeof meta.worldSeed === "number" && typeof meta.loops === "number" && typeof meta.points === "number" && Array.isArray(meta.perks) && Array.isArray(meta.history) && typeof run.rng === "number" && typeof run.minute === "number" && typeof run.phase === "string" && typeof run.location === "string" && typeof run.money === "number" && !!run.stats && Array.isArray(run.inventory) && run.inventory.every((st) => typeof asObj(st)?.where === "string" && typeof asObj(st)?.id === "number" && typeof asObj(st)?.x === "number") && typeof run.nextPieceId === "number" && "vehicle" in run && Array.isArray(run.effects) && Array.isArray(run.crops);
}

// src/web/messages.ts
function unreachable(x) {
  throw new Error(`\u672A\u5904\u7406\u7684\u5206\u652F: ${JSON.stringify(x)}`);
}
var STAT_LABEL = { satiety: "\u9971\u8179", health: "\u5065\u5EB7", energy: "\u7CBE\u529B", mood: "\u5FC3\u6001" };
var CAUSE_LABEL = {
  starvation: "\u997F\u6B7B",
  exhaustion: "\u529B\u7AED\u800C\u4EA1",
  despair: "\u7EDD\u671B",
  infection: "\u4F24\u53E3\u611F\u67D3",
  poison: "\u4E2D\u6BD2",
  horde: "\u88AB\u5C38\u6F6E\u51B2\u57AE",
  injury: "\u641C\u522E\u65F6\u8D1F\u4F24",
  away_from_home: "\u707E\u96BE\u964D\u4E34\u65F6\u8FD8\u5728\u5C4B\u5916",
  survived: "\u6D3B\u5230\u4E86\u6700\u540E",
  unknown: "\u4E0D\u660E\u539F\u56E0"
};
var causeLabel = (cause) => CAUSE_LABEL[cause] ?? cause;
var POWER_LABEL = { grid: "\u7535\u7F51\u4F9B\u7535", generator: "\u53D1\u7535\u673A\u4F9B\u7535", off: "\u65AD\u7535" };
var itemName = (d, id) => d.items[id]?.name ?? id;
var locationName = (d, id) => d.locations[id]?.name ?? id;
var areaName = (d, id) => d.areas[id]?.name ?? id;
var facilityName = (d, id) => d.facilities[id]?.name ?? id;
var recipeName = (d, id) => d.recipes[id]?.name ?? id;
var cropName = (d, id) => d.crops[id]?.name ?? id;
var effectName = (d, id) => d.effects[id]?.name ?? id;
var weatherName = (d, id) => d.weather[id]?.name ?? id;
var perkName = (d, id) => d.perks[id]?.name ?? id;
var characterName = (d, id) => d.characters[id]?.name ?? id;
var vehicleName = (d, id) => d.vehicles[id]?.name ?? id;
var CONTAINER_LABEL = { [BACKPACK]: "\u80CC\u5305", [TRUNK]: "\u540E\u5907\u7BB1", [HOME]: "\u5BB6\u4E2D\u5730\u9762", [HAND]: "\u624B\u8FB9" };
var containerName = (d, id) => CONTAINER_LABEL[id] ?? facilityName(d, id);
function fmtItems(d, m, empty = "\u65E0") {
  const parts = Object.entries(m).filter(([, q]) => q > 0).map(([id, q]) => `${itemName(d, id)}\xD7${q}`);
  return parts.length ? parts.join("\u3001") : empty;
}
function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} \u5206\u949F`;
  const h2 = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h2} \u5C0F\u65F6` : `${h2} \u5C0F\u65F6 ${r} \u5206`;
}
function clockLabel(d, minute) {
  const cm = clockMinuteOfDay(d, minute);
  return `${String(Math.floor(cm / 60)).padStart(2, "0")}:${String(cm % 60).padStart(2, "0")}`;
}
function timeLabel(d, minute) {
  const day = baseDay(d, minute);
  return `${day === 0 ? "\u707E\u524D" : `\u7B2C${day}\u5929`} ${clockLabel(d, minute)}`;
}
function eventText(d, e) {
  switch (e.code) {
    case "arrived":
      return `\u5230\u8FBE\u4E86${locationName(d, e.location)}\u3002`;
    case "bought":
      return `\u4E70\u5165 ${itemName(d, e.item)}\xD7${e.qty},\u82B1\u4E86 \xA5${e.cost}\u3002`;
    case "vehicle_bought":
      return `\u4E70\u4E0B\u4E86${vehicleName(d, e.vehicle)},\u82B1\u4E86 \xA5${e.cost}\u3002\u4E4B\u540E\u8DD1\u4E00\u8D9F\u66F4\u5FEB,\u8FD8\u80FD\u591A\u88C5\u4E00\u540E\u5907\u7BB1\u3002`;
    case "moved":
      return `\u628A ${itemName(d, e.item)}\xD7${e.qty} \u4ECE${containerName(d, e.from)}\u642C\u5230\u4E86${containerName(d, e.to)}\u3002`;
    case "unloaded": {
      const head = e.auto ? `\u540E\u5907\u7BB1\u91CC\u7684\u4E1C\u897F\u642C\u8FDB\u4E86\u5BB6:${fmtItems(d, e.items)}\u3002` : `\u628A\u968F\u8EAB\u7684\u4E1C\u897F\u653E\u8FDB\u4E86\u5BB6\u91CC:${fmtItems(d, e.items)}\u3002`;
      return Object.keys(e.toHand).length ? `${head}\u5BB6\u91CC\u653E\u4E0D\u4E0B\u7684\u5148\u6401\u5728\u624B\u8FB9:${fmtItems(d, e.toHand)}\u3002` : head;
    }
    case "to_hand":
      return `\u653E\u4E0D\u4E0B\u4E86,\u5148\u62FF\u5728\u624B\u8FB9:${fmtItems(d, e.items)}\u3002\u79BB\u5F00\u8FD9\u91CC\u4E4B\u524D\u8BB0\u5F97\u6536\u597D\u3002`;
    case "stowed":
      return `\u628A\u624B\u8FB9\u7684\u4E1C\u897F\u6536\u4E86\u8D77\u6765:${fmtItems(d, e.items)}\u3002`;
    case "arranged":
      return `\u628A${containerName(d, e.where)}\u6574\u7406\u4E86\u4E00\u904D\u3002`;
    case "hand_left": {
      const parts = [];
      if (Object.keys(e.placed).length) parts.push(`\u624B\u8FB9\u7684 ${fmtItems(d, e.placed)} \u968F\u624B\u653E\u8FDB\u4E86\u5BB6\u91CC`);
      if (Object.keys(e.lost).length) parts.push(`${fmtItems(d, e.lost)} \u6CA1\u5730\u65B9\u653E,\u7559\u5728\u4E86${locationName(d, e.location)}`);
      return `\u79BB\u5F00${locationName(d, e.location)}:${parts.join(";")}\u3002`;
    }
    case "disaster_begins":
      return "\u707E\u96BE\u964D\u4E34\u4E86\u3002\u57CE\u5E02\u7684\u79E9\u5E8F\u5728\u4E00\u591C\u4E4B\u95F4\u5D29\u584C,\u7A97\u5916\u4F20\u6765\u7B2C\u4E00\u58F0\u5C16\u53EB\u3002";
    case "away_penalty":
      return `\u707E\u96BE\u964D\u4E34\u65F6\u4F60\u8FD8\u5728\u5C4B\u5916,\u4ED3\u7687\u9003\u56DE\u5BB6,\u4E22\u5931\u4E86 ${fmtItems(d, e.lostItems, "(\u5E78\u597D\u6CA1\u4E22\u4E1C\u897F)")},\u5065\u5EB7 -${e.healthLoss}\u3002`;
    case "day_start":
      return `\u2014\u2014 \u7B2C ${e.day} \u5929 \xB7 ${weatherName(d, e.weather)} \u2014\u2014`;
    case "used":
      return `\u4F7F\u7528\u4E86 ${itemName(d, e.item)}\u3002`;
    case "discarded":
      return `\u4E22\u5F03\u4E86 ${itemName(d, e.item)}\xD7${e.qty}\u3002`;
    case "slept":
      return `\u7761\u4E86 ${e.hours} \u5C0F\u65F6\u3002`;
    case "waited":
      return `\u7B49\u5F85\u4E86 ${fmtDuration(e.minutes)}\u3002`;
    case "cooked":
      return `\u505A\u597D\u4E86\u300C${recipeName(d, e.recipe)}\u300D\u3002`;
    case "planted":
      return `\u5728 ${e.slot + 1} \u53F7\u79CD\u690D\u4F4D\u79CD\u4E0B\u4E86${cropName(d, e.crop)}\u3002`;
    case "crop_ready":
      return `${e.slot + 1} \u53F7\u79CD\u690D\u4F4D\u7684${cropName(d, e.crop)}\u6210\u719F\u4E86\u3002`;
    case "harvested":
      return `\u6536\u83B7\u4E86 ${fmtItems(d, e.yields)}\u3002`;
    case "built":
      return `${facilityName(d, e.facility)}\u5DF2\u5B8C\u6210,\u5F53\u524D ${e.level} \u7EA7\u3002`;
    case "spoiled":
      return `${itemName(d, e.item)}\xD7${e.qty} \u8150\u8D25\u4E86\u3002`;
    case "effect_started":
      return `\u3010${effectName(d, e.effect)}\u3011${d.effects[e.effect]?.description ?? ""}`;
    case "effect_ended":
      return `\u3010${effectName(d, e.effect)}\u3011\u7ED3\u675F\u4E86\u3002`;
    case "power_changed":
      return `\u4F9B\u7535\u53D8\u5316:${POWER_LABEL[e.power]}\u3002`;
    case "scavenged":
      return `\u5728${areaName(d, e.area)}\u641C\u522E\u5230:${fmtItems(d, e.loot, "\u4E00\u65E0\u6240\u83B7")}\u3002`;
    case "loot_left_behind":
      return `\u80CC\u5305\u88C5\u4E0D\u4E0B\u4E86,\u53EA\u597D\u628A ${fmtItems(d, e.items)} \u7559\u5728${areaName(d, e.area)}\u3002`;
    case "scavenge_injury":
      return `\u5728${areaName(d, e.area)}\u906D\u9047\u4E86\u5371\u9669,\u5065\u5EB7 -${e.damage}\u3002`;
    case "horde_arrives":
      return `\u5C38\u6F6E\u6765\u88AD!\u5F3A\u5EA6 ${e.strength},\u4F60\u7684\u9632\u5FA1 ${e.defense}\u3002`;
    case "horde_repelled":
      return "\u9632\u7EBF\u5B88\u4F4F\u4E86,\u5C38\u6F6E\u9000\u53BB\u3002";
    case "horde_breach":
      return `\u9632\u7EBF\u88AB\u7A81\u7834!\u5065\u5EB7 -${e.damage},\u88AB\u62A2\u8D70\u4E86 ${fmtItems(d, e.lostItems, "(\u4EC0\u4E48\u90FD\u6CA1\u4E22)")}\u3002`;
    case "death":
      return `\u4F60\u6B7B\u4E86:${causeLabel(e.cause)}(\u7B2C ${e.day} \u5929)\u3002`;
    case "victory":
      return `\u4F60\u71AC\u8FC7\u4E86 ${e.day} \u5929,\u6551\u63F4\u7EC8\u4E8E\u5230\u4E86\u3002`;
    case "run_settled":
      return `\u672C\u8F6E\u7ED3\u7B97:\u83B7\u5F97 ${e.pointsEarned} \u79EF\u5206\u3002`;
    case "perk_bought":
      return `\u83B7\u5F97\u6C38\u4E45\u5F3A\u5316\u300C${perkName(d, e.perk)}\u300D\u3002`;
    case "rebirth":
      return `\u7B2C ${e.loop} \u8F6E\u5F00\u59CB,\u4F60\u4EE5\u300C${characterName(d, e.character)}\u300D\u7684\u8EAB\u4EFD\u9192\u6765\u3002`;
    default:
      return unreachable(e);
  }
}
function actionLabel(d, a) {
  switch (a.type) {
    case "travel":
      return `\u524D\u5F80${locationName(d, a.to)}`;
    case "buy":
      return `\u4E70 ${itemName(d, a.item)} \xD7${a.qty}`;
    case "buyVehicle":
      return `\u4E70\u4E0B${vehicleName(d, a.vehicle)}`;
    case "startDisaster":
      return "\u56DE\u5BB6\u7B49\u5F85\u707E\u96BE";
    case "use":
      return `\u4F7F\u7528 ${itemName(d, a.item)}`;
    case "discard":
      return a.qty ? `\u4E22\u6389 ${a.qty} \u4E2A` : "\u4E22\u6389\u8FD9\u4E00\u5806";
    case "place":
      return a.to === HAND ? "\u62FF\u5230\u624B\u8FB9" : `\u653E\u5230${containerName(d, a.to)}`;
    case "unloadAll":
      return "\u628A\u968F\u8EAB\u7684\u4E1C\u897F\u653E\u8FDB\u5BB6\u91CC";
    case "stowHand":
      return "\u628A\u624B\u8FB9\u7684\u4E1C\u897F\u6536\u8D77\u6765";
    case "discardHand":
      return "\u6254\u6389\u624B\u8FB9\u7684\u4E1C\u897F";
    case "autoArrange":
      return `\u6574\u7406${containerName(d, a.where)}`;
    case "wait":
      return `\u7B49\u5F85 ${fmtDuration(a.minutes)}`;
    case "sleep":
      return `\u7761 ${a.hours} \u5C0F\u65F6`;
    case "cook":
      return `\u70F9\u996A:${recipeName(d, a.recipe)}`;
    case "plant":
      return `\u79CD\u4E0B ${cropName(d, a.crop)}`;
    case "harvest":
      return `\u6536\u83B7 ${a.slot + 1} \u53F7\u79CD\u690D\u4F4D`;
    case "build":
      return `\u5EFA\u9020 / \u5347\u7EA7 ${facilityName(d, a.facility)}`;
    case "scavenge":
      return `\u63A2\u7D22:${areaName(d, a.area)}`;
    case "buyPerk":
      return `\u8D2D\u4E70\u300C${perkName(d, a.perk)}\u300D`;
    case "rebirth":
      return `\u4EE5\u300C${characterName(d, a.character)}\u300D\u91CD\u751F`;
    default:
      return unreachable(a);
  }
}
var ERROR_TEXT = {
  wrong_phase: "\u73B0\u5728\u4E0D\u80FD\u8FD9\u4E48\u505A",
  invalid_argument: "\u53C2\u6570\u4E0D\u5408\u6CD5",
  unknown_id: "\u627E\u4E0D\u5230\u8FD9\u4E2A\u5BF9\u8C61",
  not_at_home: "\u9700\u8981\u5728\u5BB6\u91CC",
  not_at_shop: "\u8FD9\u91CC\u4E0D\u662F\u5546\u5E97",
  already_here: "\u5DF2\u7ECF\u5728\u8FD9\u91CC\u4E86",
  no_route: "\u6CA1\u6709\u76F4\u8FBE\u7684\u8DEF",
  not_in_stock: "\u5E93\u5B58\u4E0D\u8DB3",
  not_enough_money: "\u94B1\u4E0D\u591F",
  not_enough_time: "\u65F6\u95F4\u4E0D\u591F\u4E86(\u56E4\u8D27\u65F6\u95F4\u5C06\u5C3D)",
  missing_items: "\u6750\u6599\u6216\u7269\u54C1\u4E0D\u8DB3",
  not_usable: "\u8FD9\u4E2A\u4E1C\u897F\u4E0D\u80FD\u76F4\u63A5\u4F7F\u7528",
  missing_facility: "\u9700\u8981\u5148\u5EFA\u9020\u5BF9\u5E94\u8BBE\u65BD",
  no_free_slot: "\u6CA1\u6709\u7A7A\u7684\u79CD\u690D\u4F4D",
  slot_empty: "\u8FD9\u4E2A\u79CD\u690D\u4F4D\u662F\u7A7A\u7684",
  crop_not_ready: "\u4F5C\u7269\u8FD8\u6CA1\u6210\u719F",
  max_level: "\u5DF2\u7ECF\u662F\u6700\u9AD8\u7B49\u7EA7",
  weather_blocked: "\u4ECA\u5929\u7684\u5929\u6C14\u65E0\u6CD5\u5916\u51FA",
  area_locked: "\u8FD9\u4E2A\u533A\u57DF\u8FD8\u6CA1\u6709\u89E3\u9501",
  not_enough_points: "\u79EF\u5206\u4E0D\u591F",
  perk_owned: "\u5DF2\u7ECF\u62E5\u6709",
  no_space: "\u88C5\u4E0D\u4E0B\u4E86",
  container_unavailable: "\u8FD9\u4E2A\u50A8\u7269\u5904\u8FD8\u4E0D\u80FD\u7528",
  not_accepted: "\u8FD9\u91CC\u4E0D\u6536\u8FD9\u7C7B\u4E1C\u897F",
  already_done: "\u5DF2\u7ECF\u505A\u8FC7\u4E86",
  out_of_bounds: "\u8D85\u51FA\u683C\u5B50\u4E86",
  blocked: "\u8FD9\u91CC\u88AB\u522B\u7684\u4E1C\u897F\u5360\u7740"
};
var errorText = (code) => ERROR_TEXT[code];

// src/web/view.ts
var GROUP_ORDER = [
  { title: "\u79FB\u52A8", types: ["travel", "startDisaster"] },
  { title: "\u8D2D\u4E70", types: ["buyVehicle", "buy"] },
  { title: "\u4F7F\u7528\u7269\u54C1", types: ["use"] },
  { title: "\u4F11\u606F", types: ["sleep", "wait"] },
  { title: "\u636E\u70B9", types: ["cook", "plant", "harvest", "build"] },
  { title: "\u5916\u51FA\u63A2\u7D22", types: ["scavenge"] },
  { title: "\u6574\u7406", types: ["unloadAll", "stowHand", "discardHand"] },
  { title: "\u6C38\u4E45\u5F3A\u5316", types: ["buyPerk"] },
  { title: "\u91CD\u751F", types: ["rebirth"] }
];
var SPOIL_SOON_FRACTION = 0.2;
function worldOf(data2, s) {
  return { data: data2, meta: s.meta, run: s.run };
}
function buildView(data2, s) {
  const { run, meta } = s;
  const cfg = data2.config;
  const day = baseDay(data2, run.minute);
  const stats = STAT_IDS.map((id) => ({
    id,
    label: STAT_LABEL[id],
    value: Math.round(run.stats[id]),
    max: cfg.statMax,
    pct: Math.max(0, Math.min(100, run.stats[id] / cfg.statMax * 100)),
    low: run.stats[id] < cfg.statMax * 0.2
  }));
  const w = worldOf(data2, s);
  const options = legalActions(data2, s);
  const toButton = (o, key, label = actionLabel(data2, o.action)) => ({
    key,
    label,
    enabled: o.enabled,
    why: o.enabled || !o.reason ? void 0 : errorText(o.reason),
    action: o.action
  });
  const pieceActions = (id, item) => [
    ...options.filter((o) => o.action.type === "use" && o.action.item === item).map((o, i) => toButton(o, `p${id}:use:${i}`)),
    ...options.filter((o) => (o.action.type === "discard" || o.action.type === "place") && o.action.piece === id).map((o, i) => toButton(o, `p${id}:${i}`))
  ];
  const accessible = accessibleContainers(w);
  const carried = [HAND, BACKPACK, TRUNK].filter((c) => containerExists(w, c) && (c !== HAND || run.inventory.some((p) => p.where === HAND)));
  const containers = [...carried, ...homeContainers(w)].map((where) => {
    const pieces = run.inventory.filter((p) => p.where === where).sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id).map((p) => {
      const def = data2.items[p.item];
      const shelf = def?.shelfLifeMinutes;
      const shape = itemShape(data2, p.item);
      return {
        id: p.id,
        item: p.item,
        name: itemName(data2, p.item),
        glyph: def?.glyph ?? itemName(data2, p.item).slice(0, 1),
        qty: p.qty,
        stack: itemStack(data2, p.item),
        x: p.x,
        y: p.y,
        rot: p.rot,
        shape,
        cells: shapeCells(shape, p.rot),
        spoilingSoon: shelf !== void 0 && shelf - p.age <= shelf * SPOIL_SOON_FRACTION && shelf - p.age <= 1440,
        actions: pieceActions(p.id, p.item)
      };
    });
    const st = storageOf(w, where);
    const notes = [];
    if (st?.spoilMult !== void 0) {
      const m = containerSpoilMult(w, where);
      notes.push(m < 1 ? `\u51B7\u85CF\u4E2D,\u8150\u8D25 \xD7${m}` : "\u65AD\u7535,\u4FDD\u9C9C\u5931\u6548");
    }
    if (st?.breachLossMult !== void 0) notes.push(st.breachLossMult === 0 ? "\u5C38\u6F6E\u627E\u4E0D\u5230" : `\u5C38\u6F6E\u635F\u5931 \xD7${st.breachLossMult}`);
    if (st?.autoFill === false) notes.push("\u4E0D\u4F1A\u81EA\u52A8\u653E\u4E1C\u897F\u8FDB\u6765");
    if (where === HAND) notes.push("\u79BB\u5F00\u8FD9\u91CC\u65F6,\u653E\u4E0D\u8FDB\u5BB6\u91CC\u7684\u4F1A\u7559\u4E0B");
    const arrangeOpt = options.find((o) => o.action.type === "autoArrange" && o.action.where === where);
    const grid = gridOf(w, where);
    return {
      id: where,
      name: containerName(data2, where),
      grid: grid ? { w: grid.w, h: grid.h } : null,
      pieces,
      used: containerUsed(w, where),
      accessible: accessible.includes(where),
      notes,
      arrange: arrangeOpt ? toButton(arrangeOpt, `arrange:${where}`, "\u6574\u7406") : null
    };
  });
  const effects = activeEffectIds(w).map((id) => effectName(data2, id));
  const weather = currentWeather(w);
  const inBase = run.phase === "base";
  const known = /* @__PURE__ */ new Set([...meta.knowledge.weatherDays, ...run.seen.weatherDays]);
  const knownHordes = /* @__PURE__ */ new Set([...meta.knowledge.hordeIndices, ...run.seen.hordeIndices]);
  const first = Math.max(1, day);
  const forecast = [];
  for (let d = first; d < first + 5 && d <= cfg.targetDays; d++) {
    const isKnown = known.has(d);
    forecast.push({ day: d, known: isKnown, weather: isKnown ? weatherName(data2, weatherForDay(data2, meta, d).id) : "\uFF1F" });
  }
  const hordes = data2.hordes.map((h2, i) => {
    const isKnown = knownHordes.has(i) || run.hordesDone.includes(i);
    return {
      day: h2.day,
      known: isKnown,
      strength: isKnown ? String(h2.strength) : "\uFF1F",
      done: run.hordesDone.includes(i) || hordeMinute(data2, h2) <= run.minute
    };
  });
  const crops = run.crops.map((slot, i) => {
    if (!slot) return { slot: i, text: "\u7A7A" };
    const def = data2.crops[slot.crop];
    const left = slot.plantedAt + (def?.growMinutes ?? 0) - run.minute;
    return { slot: i, text: left <= 0 ? `${cropName(data2, slot.crop)}(\u53EF\u6536\u83B7)` : `${cropName(data2, slot.crop)}(\u8FD8\u9700 ${fmtDuration(left)})` };
  });
  const facilities = Object.keys(data2.facilities).sort().map((id) => ({ id, name: facilityName(data2, id), level: run.facilities[id] ?? 0, maxLevel: data2.facilities[id].levels.length }));
  const groups = [];
  for (const g of GROUP_ORDER) {
    const buttons = options.filter((o) => g.types.includes(o.action.type)).map((o, i) => toButton(o, `${g.title}:${i}`));
    if (buttons.length) groups.push({ title: g.title, buttons });
  }
  const e = run.ending;
  const ending = e ? {
    title: e.kind === "victory" ? "\u4F60\u6D3B\u4E86\u4E0B\u6765" : "\u4F60\u6B7B\u4E86",
    detail: e.kind === "victory" ? `\u71AC\u8FC7\u4E86 ${e.day} \u5929\u3002` : `\u7B2C ${e.day} \u5929,${causeLabel(e.cause)}\u3002`
  } : null;
  return {
    phase: run.phase,
    loop: run.loop,
    character: characterName(data2, run.character),
    timeText: timeLabel(data2, run.minute),
    where: locationName(data2, run.location),
    money: run.money,
    vehicle: run.vehicle ? vehicleName(data2, run.vehicle) : null,
    stats,
    containers,
    effects,
    weatherToday: weather ? weatherName(data2, weather.id) : null,
    power: inBase ? POWER_LABEL[powerState(w)] : null,
    defense: inBase ? totalDefense(w) : 0,
    facilities,
    crops,
    forecast,
    hordes,
    groups,
    meta: {
      points: meta.points,
      loops: meta.loops,
      bestDay: meta.bestDay,
      perks: meta.perks.map((id) => data2.perks[id]?.name ?? id),
      history: meta.history.map((h2) => ({
        loop: h2.loop,
        text: `${characterName(data2, h2.character)} \xB7 ${h2.kind === "victory" ? "\u901A\u5173" : `${h2.days} \u5929 ${causeLabel(h2.cause)}`} \xB7 +${h2.pointsEarned}`
      }))
    },
    ending
  };
}
function logLines(data2, events) {
  return events.map((e) => ({ text: `[${timeLabel(data2, e.t)}] ${eventText(data2, e)}`, tag: e.tag }));
}

// src/web/main.ts
var SAVE_KEY = "survival-proto/save";
var LOG_KEY = "survival-proto/log";
var LOG_LIMIT = 200;
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    else if (typeof v === "boolean") {
      if (v) el.setAttribute(k, "");
    } else el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== void 0 && c !== false) el.append(c);
  return el;
}
var data;
var session = null;
var log = [];
function save() {
  if (!session) return;
  try {
    localStorage.setItem(SAVE_KEY, serializeSession(session));
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-LOG_LIMIT)));
  } catch {
  }
}
function load() {
  const text = localStorage.getItem(SAVE_KEY);
  session = text ? deserializeSession(data, text) : null;
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]");
    log = Array.isArray(raw) ? raw.filter((l) => l && typeof l.text === "string" && typeof l.tag === "string") : [];
  } catch {
    log = [];
  }
  if (!session) log = [];
}
function act(action) {
  if (!session) return;
  const r = step(data, session, action);
  if (!r.ok) return;
  session = r.session;
  if (held && !session.run.inventory.some((p) => p.id === held.piece)) held = null;
  log.push(...logLines(data, r.events));
  if (log.length > LOG_LIMIT) log = log.slice(-LOG_LIMIT);
  save();
  render();
}
function startNew(character) {
  const seed = Math.random() * 2147483647 | 0;
  session = newSession(data, { character, worldSeed: seed });
  log = [{ text: `\u65B0\u7684\u4E16\u754C(\u79CD\u5B50 ${seed})\u3002\u4F60\u4EE5\u300C${data.characters[character].name}\u300D\u7684\u8EAB\u4EFD\u9192\u6765,\u8DDD\u79BB\u672B\u65E5\u8FD8\u6709 ${Math.round(data.config.stockpileMinutes / 60)} \u5C0F\u65F6\u3002`, tag: "info" }];
  save();
  render();
}
function resetGame() {
  if (!confirm("\u653E\u5F03\u5F53\u524D\u5B58\u6863(\u542B\u6240\u6709\u8F6E\u56DE\u8FDB\u5EA6)\u5E76\u91CD\u65B0\u5F00\u59CB?")) return;
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(LOG_KEY);
  session = null;
  log = [];
  render();
}
function exportSave() {
  if (!session) return;
  const blob = new Blob([serializeSession(session)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `survival-save-loop${session.run.loop}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
}
function importSave() {
  const input = h("input", { type: "file", accept: "application/json" });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    const s = deserializeSession(data, await file.text());
    if (!s) return alert("\u5B58\u6863\u65E0\u6548\u6216\u7248\u672C\u4E0D\u7B26\u3002");
    session = s;
    log = [{ text: "\u5DF2\u5BFC\u5165\u5B58\u6863\u3002", tag: "info" }];
    save();
    render();
  });
  input.click();
}
function bar(label, value, max, pct, low) {
  const fill = h("div", { class: "fill" });
  fill.style.width = `${pct}%`;
  return h("div", { class: `stat${low ? " low" : ""}` }, h("span", { class: "label" }, label), h("div", { class: "bar" }, fill), h("span", { class: "num" }, `${value}/${max}`));
}
function section(title, ...children) {
  return h("section", {}, h("h2", {}, title), ...children);
}
function list(items, empty = "\u65E0") {
  if (!items.length) return h("p", { class: "muted" }, empty);
  return h("ul", {}, ...items.map((t) => h("li", {}, t)));
}
function renderStatus(v) {
  const head = h(
    "div",
    { class: "head" },
    h("strong", {}, `\u7B2C ${v.loop} \u8F6E \xB7 ${v.character}`),
    ` \xB7 ${v.timeText} \xB7 ${v.where} \xB7 \xA5${v.money}`,
    v.vehicle && v.phase === "stockpile" ? ` \xB7 ${v.vehicle}` : null,
    v.weatherToday ? ` \xB7 ${v.weatherToday}` : null,
    v.power ? ` \xB7 ${v.power}` : null,
    v.phase === "base" ? ` \xB7 \u9632\u5FA1 ${v.defense}` : null
  );
  return section("\u72B6\u6001", head, ...v.stats.map((s) => bar(s.label, s.value, s.max, s.pct, s.low)), v.effects.length ? h("p", { class: "effects" }, `\u72B6\u6001\u6548\u679C:${v.effects.join("\u3001")}`) : null);
}
function actionButton(b, cls = "") {
  const btn = h("button", { type: "button", class: cls, disabled: !b.enabled, title: b.why ?? "" }, b.label);
  if (b.enabled) btn.addEventListener("click", () => act(b.action));
  return btn;
}
var held = null;
var hover = null;
var CELL = 30;
function heldPiece(v) {
  if (!held) return null;
  for (const c of v.containers) for (const p of c.pieces) if (p.id === held.piece) return p;
  return null;
}
function placeAction(p, to, x, y, rot, one) {
  return { type: "place", piece: p.id, qty: one ? 1 : void 0, to, x, y, rot };
}
function rotateHeld() {
  if (!held) return;
  held.rot = (held.rot + 90) % 360;
  render();
}
function renderGrid(v, c) {
  const g = c.grid;
  const board = h("div", { class: "board" });
  board.style.gridTemplateColumns = `repeat(${g.w}, ${CELL}px)`;
  board.style.gridTemplateRows = `repeat(${g.h}, ${CELL}px)`;
  const hp = heldPiece(v);
  let preview = null;
  if (hp && held && hover && hover.where === c.id && session) {
    const cells = shapeCellsOf(hp, held.rot);
    const check = checkAction(data, session, placeAction(hp, c.id, hover.x, hover.y, held.rot, held.one));
    preview = { cells: new Set(cells.map(([cx, cy]) => `${hover.x + cx},${hover.y + cy}`)), ok: check.enabled, why: check.reason ? errorText(check.reason) : "" };
  }
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const key = `${x},${y}`;
      const cls = ["cell"];
      if (preview?.cells.has(key)) cls.push(preview.ok ? "ok" : "bad");
      const cell = h("div", { class: cls.join(" "), title: preview?.cells.has(key) && !preview.ok ? preview.why : "" });
      cell.style.gridColumn = String(x + 1);
      cell.style.gridRow = String(y + 1);
      cell.addEventListener("mouseenter", () => {
        if (!held || hover && hover.where === c.id && hover.x === x && hover.y === y) return;
        hover = { where: c.id, x, y };
        render();
      });
      cell.addEventListener("click", () => {
        if (!held || !hp || !session || !c.accessible) return;
        const a = placeAction(hp, c.id, x, y, held.rot, held.one);
        if (!checkAction(data, session, a).enabled) return;
        held = null;
        act(a);
      });
      board.append(cell);
    }
  }
  const owner = /* @__PURE__ */ new Map();
  for (const p of c.pieces) for (const [cx, cy] of p.cells) owner.set(`${p.x + cx},${p.y + cy}`, p.id);
  for (const p of c.pieces) {
    const isHeld = held?.piece === p.id;
    const edge = isHeld ? "var(--accent)" : p.spoilingSoon ? "var(--warn)" : "rgba(0, 0, 0, .65)";
    for (const [cx, cy] of p.cells) {
      const first = cx === p.cells[0][0] && cy === p.cells[0][1];
      const gx = p.x + cx;
      const gy = p.y + cy;
      const el = h(
        "div",
        { class: `piece${isHeld ? " held" : ""}`, title: `${p.name} \xD7${p.qty}${p.stack > 1 ? ` / ${p.stack}` : ""}${p.spoilingSoon ? "(\u5FEB\u574F\u4E86)" : ""}` },
        first ? p.glyph : "",
        first && p.qty > 1 ? h("span", { class: "qty" }, String(p.qty)) : null
      );
      el.style.gridColumn = String(gx + 1);
      el.style.gridRow = String(gy + 1);
      el.style.setProperty("--hue", String(hueOf(p.item)));
      const other = (dx, dy) => owner.get(`${gx + dx},${gy + dy}`) !== p.id;
      el.style.boxShadow = [
        other(0, -1) && `inset 0 2px 0 ${edge}`,
        other(0, 1) && `inset 0 -2px 0 ${edge}`,
        other(-1, 0) && `inset 2px 0 0 ${edge}`,
        other(1, 0) && `inset -2px 0 0 ${edge}`
      ].filter(Boolean).join(", ");
      el.addEventListener("mouseenter", () => {
        if (!held || hover && hover.where === c.id && hover.x === p.x + cx && hover.y === p.y + cy) return;
        hover = { where: c.id, x: p.x + cx, y: p.y + cy };
        render();
      });
      el.addEventListener("click", (e) => {
        if (!c.accessible) return;
        if (held && held.piece !== p.id && hp && session) {
          const a = placeAction(hp, c.id, p.x + cx, p.y + cy, held.rot, held.one);
          if (checkAction(data, session, a).enabled) {
            held = null;
            act(a);
            return;
          }
        }
        held = held?.piece === p.id ? null : { piece: p.id, rot: p.rot, one: e.shiftKey && p.qty > 1 };
        hover = null;
        render();
      });
      board.append(el);
    }
  }
  board.addEventListener("mouseleave", () => {
    if (hover?.where === c.id) {
      hover = null;
      render();
    }
  });
  return board;
}
function shapeCellsOf(p, rot) {
  return shapeCells(p.shape, rot);
}
function hueOf(item) {
  let x = 0;
  for (const ch of item) x = (x * 31 + ch.charCodeAt(0)) % 360;
  return x;
}
function renderHand(v, c) {
  const hp = heldPiece(v);
  const list2 = h("div", { class: "hand" });
  for (const p of c.pieces) {
    const chip = h("button", { type: "button", class: `chip${held?.piece === p.id ? " held" : ""}` }, `${p.glyph} ${p.name} \xD7${p.qty}`);
    chip.style.setProperty("--hue", String(hueOf(p.item)));
    chip.addEventListener("click", (e) => {
      held = held?.piece === p.id ? null : { piece: p.id, rot: p.rot, one: e.shiftKey && p.qty > 1 };
      render();
    });
    list2.append(chip);
  }
  if (hp && held && session && hp.id !== void 0 && !c.pieces.some((p) => p.id === hp.id)) {
    const a = placeAction(hp, HAND, 0, 0, 0, held.one);
    const target = h("button", { type: "button", class: "chip drop" }, "\u653E\u5230\u624B\u8FB9");
    target.addEventListener("click", () => {
      held = null;
      act(a);
    });
    list2.append(target);
  }
  return list2;
}
function renderContainer(v, c) {
  const size = c.grid ? `${c.used}/${c.grid.w * c.grid.h} \u683C` : `${c.pieces.length} \u5806`;
  const title = h(
    "h3",
    {},
    `${c.name} \xB7 ${size}${c.accessible ? "" : "(\u4E0D\u5728\u8EAB\u8FB9)"}`,
    c.notes.length ? ` \xB7 ${c.notes.join(" \xB7 ")}` : null,
    c.arrange && c.accessible ? actionButton(c.arrange, "small") : null
  );
  const body = c.grid ? renderGrid(v, c) : renderHand(v, c);
  return h("div", { class: `container${c.accessible ? "" : " away"}${c.grid ? "" : " hand-box"}` }, title, body);
}
function renderHeldBar(v) {
  const p = heldPiece(v);
  if (!p || !held) return null;
  const rot = h("button", { type: "button", class: "small" }, "\u65CB\u8F6C (R)");
  rot.addEventListener("click", rotateHeld);
  const cancel = h("button", { type: "button", class: "small" }, "\u653E\u4E0B (Esc)");
  cancel.addEventListener("click", () => {
    held = null;
    render();
  });
  return h(
    "div",
    { class: "held-bar" },
    h("strong", {}, `\u62FF\u7740:${p.name} \xD7${held.one ? 1 : p.qty}`),
    p.stack > 1 && p.qty > 1 && !held.one ? h("span", { class: "muted" }, "(Shift + \u70B9\u51FB\u53EA\u62FF 1 \u4EF6)") : null,
    rot,
    cancel,
    ...p.actions.map((b) => actionButton(b, "small"))
  );
}
function renderInventory(v) {
  return section("\u7269\u54C1", renderHeldBar(v), h("p", { class: "muted hint" }, "\u70B9\u7269\u54C1\u62FF\u8D77,\u70B9\u683C\u5B50\u653E\u4E0B;R \u65CB\u8F6C\u3002"), ...v.containers.map((c) => renderContainer(v, c)));
}
function renderBase(v) {
  if (v.phase === "stockpile") return null;
  const fac = v.facilities.map((f) => `${f.name} ${f.level}/${f.maxLevel}`);
  const crops = v.crops.map((c) => `${c.slot + 1}. ${c.text}`);
  return section("\u636E\u70B9", h("p", {}, fac.join(" \xB7 ")), crops.length ? list(crops) : h("p", { class: "muted" }, "\u8FD8\u6CA1\u6709\u79CD\u690D\u4F4D"));
}
function renderIntel(v) {
  const fc = v.forecast.map((f) => `\u7B2C${f.day}\u5929 ${f.weather}`).join(" \xB7 ");
  const hz = v.hordes.map((x) => `\u7B2C${x.day}\u5929 \u5F3A\u5EA6${x.strength}${x.done ? "(\u5DF2\u8FC7)" : ""}`).join(" \xB7 ");
  return section("\u60C5\u62A5(\u8F6E\u56DE\u4E2D\u89C1\u8FC7\u7684\u672A\u6765)", h("p", {}, `\u5929\u6C14:${fc || "\u2014"}`), h("p", {}, `\u5C38\u6F6E:${hz || "\u2014"}`));
}
function renderActions(v) {
  const wrap = h("div", { class: "actions" });
  for (const g of v.groups) {
    const row = h("div", { class: "group" }, h("h3", {}, g.title));
    for (const b of g.buttons) row.append(actionButton(b));
    wrap.append(row);
  }
  return section("\u884C\u52A8", wrap);
}
function renderEnding(v) {
  if (!v.ending) return null;
  return h(
    "section",
    { class: `ending ${v.phase}` },
    h("h2", {}, v.ending.title),
    h("p", {}, v.ending.detail),
    h("p", {}, `\u79EF\u5206 ${v.meta.points} \xB7 \u6700\u4F73 ${v.meta.bestDay} \u5929 \xB7 \u5DF2\u8F6E\u56DE ${v.meta.loops} \u6B21`),
    h("p", { class: "muted" }, `\u5DF2\u6709\u5F3A\u5316:${v.meta.perks.join("\u3001") || "\u65E0"}`),
    list(v.meta.history.map((x) => `\u7B2C${x.loop}\u8F6E ${x.text}`))
  );
}
function renderLog() {
  const box = h("div", { class: "log" }, ...log.slice(-60).map((l) => h("div", { class: `line ${l.tag}` }, l.text)));
  return section("\u65E5\u5FD7", box);
}
function renderMenu() {
  return h(
    "nav",
    {},
    h("button", { type: "button", onclick: resetGame }, "\u65B0\u6E38\u620F"),
    h("button", { type: "button", onclick: exportSave, disabled: !session }, "\u5BFC\u51FA\u5B58\u6863"),
    h("button", { type: "button", onclick: importSave }, "\u5BFC\u5165\u5B58\u6863")
  );
}
function renderCharacterSelect() {
  const cards = Object.values(data.characters).map(
    (c) => h(
      "div",
      { class: "card" },
      h("h3", {}, c.name),
      h("p", {}, c.description),
      h("p", { class: "muted" }, `\u542F\u52A8\u8D44\u91D1 \xA5${c.startMoney}`),
      h("button", { type: "button", onclick: () => startNew(c.id) }, "\u4EE5\u6B64\u8EAB\u4EFD\u5F00\u59CB")
    )
  );
  return section("\u9009\u62E9\u8EAB\u4EFD", h("p", {}, `\u672B\u65E5\u5C06\u5728 ${Math.round(data.config.stockpileMinutes / 60)} \u5C0F\u65F6\u540E\u964D\u4E34\u3002\u4F60\u53EA\u6709\u8FD9\u4E00\u70B9\u65F6\u95F4\u56E4\u8D27\u3002`), h("div", { class: "cards" }, ...cards));
}
function render() {
  const root = document.getElementById("app");
  root.replaceChildren();
  root.append(renderMenu());
  if (!session) {
    root.append(renderCharacterSelect());
    return;
  }
  const v = buildView(data, session);
  const left = h("div", { class: "col" }, renderStatus(v), renderInventory(v), renderBase(v), renderIntel(v));
  const right = h("div", { class: "col" }, renderEnding(v), renderActions(v), renderLog());
  root.append(h("div", { class: "layout" }, left, right));
  const logBox = root.querySelector(".log");
  if (logBox) logBox.scrollTop = logBox.scrollHeight;
}
function main() {
  try {
    data = loadGameData();
  } catch (e) {
    document.getElementById("app").append(h("pre", { class: "error" }, e.message));
    return;
  }
  load();
  render();
  document.addEventListener("keydown", (e) => {
    if (e.target?.tagName === "INPUT") return;
    if (e.key === "r" || e.key === "R") rotateHeld();
    if (e.key === "Escape" && held) {
      held = null;
      render();
    }
  });
}
main();
