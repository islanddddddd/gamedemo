// ============================================================
// db.js —— 集中配置表（数据驱动）
// 所有物种 / 造景 / 植物 / 食物 / 设备的数值都集中在此，
// 新增内容只需向对应表追加条目，无需改动其他模块。
// ============================================================

// ---------- 稀有度（颜色用于 UI 星级、卡片描边与流光） ----------
export const RARITY = {
  1: { name: '普通', color: '#AEB8C2' },
  2: { name: '精致', color: '#5FBF7F' },
  3: { name: '稀有', color: '#4A9FD8' },
  4: { name: '史诗', color: '#B57CE0' },
  5: { name: '传说', color: '#D4A24C' },
};

// ---------- 鱼类 & 无脊椎动物 ----------
// diet: herbivore 草食 / omnivore 杂食 / carnivore 肉食 / detritivore 碎屑食
// body: 体型比例（长/高/宽，横向压缩：高>宽）
// palette: 程序化配色（身体/腹部/鳍/条纹 accent）
// depth: 偏好水层 [0=缸底, 1=水面]
export const SPECIES_DB = {
  neon: {
    id: 'neon', name: '霓虹灯鱼', rarity: 1, cat: 'fish', price: 30, sell: 10,
    diet: 'omnivore', adultLen: 0.72, babyScale: 0.35, growDays: 5,
    speed: 1.7, turn: 3.2, schooling: true, aggression: 0.05,
    lifespan: 160, metabolism: 1.0, bioload: 0.35,
    body: { len: 1.0, h: 0.40, w: 0.20 }, fin: 'short', pattern: 'stripe', stripeDir: 'along',
    glassy: false, glow: true, bottom: false,
    palette: { body: '#4A9FD8', belly: '#EAF6FF', fin: '#9FE0F5', accent: '#FF5A5A' },
    depth: [0.45, 0.75],
    breed: { medium: 'moss', days: 2, count: 5, min: 2 },
    desc: '群游性小型灯科鱼，蓝红条纹在光下格外耀眼，群游时最为动人。',
    tip: '群游需要 6 条以上才展开展现漂亮的群游编队。',
  },
  guppy: {
    id: 'guppy', name: '孔雀鱼', rarity: 2, cat: 'fish', price: 55, sell: 18,
    diet: 'omnivore', adultLen: 0.85, babyScale: 0.30, growDays: 4,
    speed: 1.4, turn: 3.6, schooling: false, aggression: 0.05,
    lifespan: 200, metabolism: 0.9, bioload: 0.3,
    body: { len: 1.0, h: 0.46, w: 0.22 }, fin: 'veil', pattern: 'patch',
    glassy: false, glow: false, bottom: false, randomTail: true,
    palette: { body: '#FF9E5A', belly: '#FFE9C9', fin: '#FF7AA8', accent: '#4A9FD8' },
    depth: [0.4, 0.85],
    breed: { medium: 'moss', days: 2, count: 8, min: 2 },
    desc: '繁殖极快的卵胎生鱼，每条都有随机生成的独特尾纹，新手最爱。',
    tip: '繁殖速度惊人，注意控制鱼口，避免密度过载。',
  },
  clown: {
    id: 'clown', name: '小丑鱼', rarity: 3, cat: 'fish', price: 120, sell: 40,
    diet: 'omnivore', adultLen: 1.05, babyScale: 0.3, growDays: 8,
    speed: 1.5, turn: 2.8, schooling: false, aggression: 0.45,
    lifespan: 260, metabolism: 1.1, bioload: 0.7,
    body: { len: 1.0, h: 0.5, w: 0.26 }, fin: 'short', pattern: 'stripe', stripeDir: 'around',
    glassy: false, glow: false, bottom: false, territory: true,
    palette: { body: '#FF7A2E', belly: '#FFF3E0', fin: '#FF9E5A', accent: '#FFFFFF' },
    depth: [0.45, 0.8],
    breed: null,
    desc: '领地性明显的壮实小鱼，会主动驱赶闯入领地的其他鱼。',
    tip: '有领地意识，和温和小型鱼混养时注意观察追逐行为。',
  },
  pleco: {
    id: 'pleco', name: '清道夫', rarity: 2, cat: 'fish', price: 70, sell: 22,
    diet: 'herbivore', adultLen: 1.5, babyScale: 0.35, growDays: 12,
    speed: 0.8, turn: 1.6, schooling: false, aggression: 0.05,
    lifespan: 320, metabolism: 0.8, bioload: 1.2, nocturnal: true,
    body: { len: 1.0, h: 0.55, w: 0.34 }, fin: 'short', pattern: 'spot',
    glassy: false, glow: false, bottom: true,
    palette: { body: '#8A7256', belly: '#D8C9A8', fin: '#6E5A42', accent: '#4A3B2A' },
    depth: [0.02, 0.25],
    breed: null,
    desc: '异形鱼，专吃藻类与残饵，夜间活跃，是缸里的清洁工。',
    tip: '夜间活跃，白天常趴在缸壁或沉木上。',
  },
  koi: {
    id: 'koi', name: '锦鲤', rarity: 4, cat: 'fish', price: 300, sell: 100,
    diet: 'omnivore', adultLen: 2.2, babyScale: 0.25, growDays: 20,
    speed: 1.2, turn: 1.2, schooling: false, aggression: 0.1,
    lifespan: 500, metabolism: 1.6, bioload: 3.0,
    body: { len: 1.0, h: 0.52, w: 0.3 }, fin: 'long', pattern: 'patch',
    glassy: false, glow: false, bottom: false,
    palette: { body: '#F5F0E6', belly: '#FFFFFF', fin: '#FF9E5A', accent: '#FF6B35' },
    depth: [0.3, 0.85],
    breed: null,
    desc: '大型杂食鱼，食量大排泄多（显著推高氨氮），寿命极长。',
    tip: '能吃能拉，一只锦鲤的生物量顶好几条小鱼，注意过滤。',
  },
  betta: {
    id: 'betta', name: '斗鱼', rarity: 3, cat: 'fish', price: 150, sell: 50,
    diet: 'carnivore', adultLen: 0.85, babyScale: 0.3, growDays: 7,
    speed: 1.6, turn: 3.4, schooling: false, aggression: 0.9,
    lifespan: 240, metabolism: 1.1, bioload: 0.6, hunter: true,
    body: { len: 1.0, h: 0.55, w: 0.24 }, fin: 'veil', pattern: 'gradient',
    glassy: false, glow: false, bottom: false,
    palette: { body: '#4A6FD8', belly: '#8FB0F0', fin: '#FF5A7A', accent: '#2EBCE8' },
    depth: [0.35, 0.9],
    breed: null,
    desc: '肉食性，高攻击性，飘逸的鳍如丝绸。饥饿时会捕食小鱼小虾。',
    tip: '建议单养；同体型鱼也会被攻击。',
  },
  glasscat: {
    id: 'glasscat', name: '玻璃猫鱼', rarity: 3, cat: 'fish', price: 110, sell: 36,
    diet: 'omnivore', adultLen: 1.15, babyScale: 0.35, growDays: 8,
    speed: 1.5, turn: 2.6, schooling: true, aggression: 0.05,
    lifespan: 220, metabolism: 1.0, bioload: 0.6, glassy: true,
    body: { len: 1.0, h: 0.34, w: 0.26 }, fin: 'long', pattern: 'none',
    glassy: true, glow: false, bottom: false,
    palette: { body: '#CFE8F5', belly: '#F5FCFF', fin: '#BFE0F0', accent: '#D8B45A' },
    depth: [0.35, 0.8],
    breed: null,
    desc: '半透明材质，内部骨架隐约可见，群游时如流动的水晶。',
    tip: '喜欢群游，半透明身体在逆光下最美。',
  },
  arowana: {
    id: 'arowana', name: '龙鱼', rarity: 5, cat: 'fish', price: 900, sell: 300,
    diet: 'carnivore', adultLen: 3.0, babyScale: 0.25, growDays: 40,
    speed: 1.8, turn: 1.4, schooling: false, aggression: 0.8, hunter: true,
    lifespan: 600, metabolism: 1.8, bioload: 6.0, bigTank: true,
    body: { len: 1.0, h: 0.42, w: 0.34 }, fin: 'long', pattern: 'gradient',
    glassy: false, glow: false, bottom: false,
    palette: { body: '#C9D6E2', belly: '#F0F6FA', fin: '#9FB8CC', accent: '#D4A24C' },
    depth: [0.3, 0.9],
    breed: null,
    desc: '顶级掠食者，会吃光所有比它小的鱼。成长后体型巨大。',
    tip: '会撑爆小缸：生物量超载时全缸鱼类压力飙升。',
  },
  shrimp: {
    id: 'shrimp', name: '樱花虾', rarity: 1, cat: 'invert', price: 15, sell: 5,
    diet: 'herbivore', adultLen: 0.16, babyScale: 0.5, growDays: 3,
    speed: 0.9, turn: 4.0, schooling: true, aggression: 0.0,
    lifespan: 120, metabolism: 0.4, bioload: 0.05,
    body: { len: 1.0, h: 0.5, w: 0.5 }, fin: 'short', pattern: 'none',
    glassy: false, glow: false, bottom: false, prey: true,
    palette: { body: '#FF6B6B', belly: '#FFD5D5', fin: '#FF9E9E', accent: '#FFFFFF' },
    depth: [0.1, 0.8],
    breed: { medium: 'moss', days: 3, count: 10, min: 3 },
    desc: '啃食藻类与残饵，是大鱼的美味点心，繁殖力强。',
    tip: '虾是藻类克星，但会被中大型鱼捕食。',
  },
  snail: {
    id: 'snail', name: '苹果螺', rarity: 1, cat: 'invert', price: 12, sell: 4,
    diet: 'herbivore', adultLen: 0.2, babyScale: 0.5, growDays: 4,
    speed: 0.25, turn: 1.0, schooling: false, aggression: 0.0,
    lifespan: 150, metabolism: 0.3, bioload: 0.05,
    body: { len: 1.0, h: 0.7, w: 0.7 }, fin: 'short', pattern: 'none',
    glassy: false, glow: false, bottom: true,
    palette: { body: '#C98A4B', belly: '#E8C08A', fin: '#B57A3B', accent: '#8A5A2B' },
    depth: [0.0, 0.5],
    breed: { medium: 'any', days: 3, count: 6, min: 2 },
    desc: '勤恳的除藻工，会在缸壁与叶面产下胶质卵囊。',
    tip: '螺会产卵囊，数量过多时可用捞网移除。',
  },
};

// ---------- 造景 / 植物 / 食物 / 设备 / 底砂 ----------
// effects 中的数值会被 sim.js 读取并转化为生态修正
export const ITEM_DB = {
  // ---- 造景（硬景） ----
  driftwood: {
    cat: 'hardscape', name: '沉木', rarity: 2, price: 60,
    desc: '释放单宁酸缓慢降 pH，水色泛黄呈"黑水缸"氛围，提供躲避（压力↓）。',
    effects: { ph: -0.35, tannin: 1.0, hideout: 2, beauty: 8 },
  },
  volcanic: {
    cat: 'hardscape', name: '火山石', rarity: 2, price: 50,
    desc: '多孔结构，硝化菌附着面积 +50%，显著加速氮循环，微弱升硬度。',
    effects: { bacteriaSurface: 0.5, gh: 0.3, beauty: 5 },
  },
  dragonstone: {
    cat: 'hardscape', name: '青龙石', rarity: 3, price: 90,
    desc: '硬水石，升高 pH/GH，利于鱼类骨骼发育，美观度 ++。',
    effects: { ph: 0.25, gh: 1.0, beauty: 14 },
  },
  crystal: {
    cat: 'hardscape', name: '水晶簇', rarity: 4, price: 220,
    desc: '夜间自发光装饰（emissive + 点光源），美观度 ++++，评分系统高分来源。',
    effects: { beauty: 26, glow: 1 },
  },
  coralsand: {
    cat: 'hardscape', name: '珊瑚骨砂', rarity: 3, price: 70,
    desc: '升高 pH/KH，缓冲酸跌，浅色底砂衬得鱼色更鲜艳。',
    effects: { ph: 0.2, kh: 1.0, beauty: 6 },
  },
  // ---- 植物 ----
  moss: {
    cat: 'plant', name: '莫斯', rarity: 2, price: 40,
    desc: '小鱼躲避所，吸收硝酸盐，是灯科鱼产卵介质。',
    effects: { no3Absorb: 0.5, o2: 0.3, hideout: 3, beauty: 10, growth: 0.8 },
  },
  hornwort: {
    cat: 'plant', name: '金鱼藻', rarity: 2, price: 35,
    desc: '速生，强吸收 NO₃；白天产氧高、夜间耗氧也高。',
    effects: { no3Absorb: 1.2, o2: 0.9, nightO2: -0.5, beauty: 8, growth: 1.5 },
  },
  anubias: {
    cat: 'plant', name: '水榕', rarity: 3, price: 55,
    desc: '慢生耐阴，宽叶可作产卵介质，叶面容易附着藻斑。',
    effects: { no3Absorb: 0.4, o2: 0.2, beauty: 14, growth: 0.5 },
  },
  duckweed: {
    cat: 'plant', name: '浮萍', rarity: 2, price: 30,
    desc: '漂浮遮光抑制藻类，但夜间耗氧，覆盖过厚会闷缸。',
    effects: { shade: 0.8, no3Absorb: 0.6, nightO2: -0.3, beauty: 6, growth: 1.0 },
  },
  // ---- 食物 ----
  flake: {
    cat: 'food', name: '薄片饲料', rarity: 1, price: 5,
    desc: '漂浮薄片，表层鱼主食；投喂过量会沉底腐败推高氨氮。',
    effects: { nutrition: 12, pollution: 0.5, surface: true },
  },
  pellet: {
    cat: 'food', name: '沉底颗粒', rarity: 1, price: 5,
    desc: '沉底颗粒，底层鱼（清道夫/螺）主食。',
    effects: { nutrition: 16, pollution: 0.4, surface: false },
  },
  bloodworm: {
    cat: 'food', name: '红虫/丰年虾', rarity: 2, price: 12,
    desc: '高营养，肉食鱼最爱；过量投喂会严重污染水质。',
    effects: { nutrition: 30, pollution: 1.2, surface: false },
  },
  // ---- 设备 ----
  filter: {
    cat: 'equip', name: '过滤器', rarity: 3, price: 150,
    desc: '水流循环 + 培菌 + 去油膜，降低浑浊度，可开关。',
    effects: { clarity: 0.6, bacteria: 0.4, flow: 1.0 },
  },
  heater: {
    cat: 'equip', name: '加热棒', rarity: 3, price: 120,
    desc: '恒温加热，目标温度 22–28℃ 可调。',
    effects: {},
  },
  lamp: {
    cat: 'equip', name: '灯具', rarity: 3, price: 130,
    desc: '开关 + 冷暖色温 + 强度滑杆，直接驱动水草光合与藻类生长。',
    effects: {},
  },
  co2: {
    cat: 'equip', name: 'CO₂ 系统', rarity: 4, price: 260,
    desc: '水草生长 +50%，但 pH 下降；过量会导致鱼类 CO₂ 中毒。',
    effects: { growth: 0.5, ph: -0.3 },
  },
  pump: {
    cat: 'equip', name: '气泵', rarity: 2, price: 80,
    desc: '溶氧 +，持续气泡粒子，附带白噪音音效。',
    effects: { o2: 0.8 },
  },
  feeder: {
    cat: 'equip', name: '自动喂食器', rarity: 3, price: 160,
    desc: '每隔数小时自动投喂一次薄片饲料，出门也能喂鱼。',
    effects: {},
  },
  // ---- 底砂（更换配色，不影响数值） ----
  sand: {
    cat: 'substrate', name: '化妆砂', rarity: 1, price: 10,
    desc: '暖米色细砂，最通用的底砂。', effects: { beauty: 2 }, substrateColor: '#E8D5A8',
  },
  clay: {
    cat: 'substrate', name: '陶粒砂', rarity: 1, price: 10,
    desc: '赤陶色颗粒，多孔可培菌，水草定植佳选。', effects: { beauty: 3, bacteriaSurface: 0.15 }, substrateColor: '#A5673F',
  },
  blacksand: {
    cat: 'substrate', name: '黑金砂', rarity: 2, price: 25,
    desc: '深黑底砂，鱼色更突出，反差强烈。', effects: { beauty: 8 }, substrateColor: '#2A2A30',
  },
};

// ---------- 水质安全区间（仪表盘颜色预警依据） ----------
export const WATER_CFG = {
  temp: { ideal: [24, 26], ok: [22, 28], warnLow: 20, warnHigh: 30, unit: '℃' },
  ph: { ideal: [6.8, 7.2], ok: [6.5, 7.5], warnLow: 6.0, warnHigh: 8.0, unit: '' },
  nh3: { safe: 0.25, warn: 0.5, danger: 1.0, max: 2.0, unit: 'ppm' },
  no2: { safe: 0.10, warn: 0.5, danger: 1.0, max: 2.0, unit: 'ppm' },
  no3: { safe: 20, warn: 40, danger: 60, max: 120, unit: 'ppm' },
  do: { good: 6.0, warn: 4.0, danger: 3.0, max: 12.0, unit: 'mg/L' },
  clarity: { good: 0.8, warn: 0.5, danger: 0.3, unit: '' }, // 1 = 完全清澈
};

// ---------- 缸体参数 ----------
export const TANK_CFG = {
  w: 6.2, d: 3.4, wallH: 3.0, waterH: 2.5, baseH: 0.35,
  capacity: 40, // 生物量上限（bioload 总和）
};

// ---------- 初始生态点 ----------
export const START_ECO = 800;

// ---------- 商店分类 ----------
export const SHOP_TABS = [
  { id: 'fish', name: '鱼类' },
  { id: 'invert', name: '无脊椎' },
  { id: 'plant', name: '植物' },
  { id: 'hardscape', name: '造景' },
  { id: 'food', name: '食物' },
  { id: 'equip', name: '设备' },
];
