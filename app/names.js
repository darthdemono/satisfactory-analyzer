// Port of sav/names.py: readable names and categories from class paths.
const OVERRIDES = {
  OreIron: "Iron Ore", OreCopper: "Copper Ore", OreGold: "Caterium Ore", OreBauxite: "Bauxite",
  OreUranium: "Uranium", RawQuartz: "Raw Quartz", Stone: "Limestone", Cement: "Concrete",
  Wire: "Wire", Cable: "Cable", CopperSheet: "Copper Sheet", IronPlate: "Iron Plate",
  IronPlateReinforced: "Reinforced Iron Plate", ModularFrame: "Modular Frame", GoldIngot: "Caterium Ingot",
  Gold: "Caterium Ore", HogParts: "Hog Remains", SpitterParts: "Plasma Spitter Remains",
  StingerParts: "Stinger Remains", HatcherParts: "Hatcher Remains", Leaves: "Leaves", Wood: "Wood",
  Mycelia: "Mycelia", Nut: "Paleberry", Berry: "Berry", SAM: "SAM Ore", SAMIngot: "Reanimated SAM",
  GenericBiomass: "Biomass", Biofuel: "Solid Biofuel", LiquidOil: "Crude Oil", HeavyOilResidue: "Heavy Oil Residue",
  NuclearFuelRod: "Uranium Fuel Rod", PetroleumCoke: "Petroleum Coke", AluminumScrap: "Aluminum Scrap",
  AluminumPlate: "Alclad Aluminum Sheet", IronRod: "Iron Rod", IronScrew: "Screw", Screw: "Screw",
  SpaceElevator: "Space Elevator", TradingPost: "The HUB", HubTerminal: "HUB Terminal",
  WorkBench: "Craft Bench", WorkBenchIntegrated: "Craft Bench (integrated)", Workshop: "Equipment Workshop",
  MinerMk1: "Miner Mk.1", MinerMk2: "Miner Mk.2", MinerMk3: "Miner Mk.3",
  GeneratorIntegratedBiomass: "Biomass Burner (integrated)", GeneratorBiomass_Automated: "Biomass Burner (automated)",
  GeneratorBiomass: "Biomass Burner", GeneratorCoal: "Coal Generator", GeneratorFuel: "Fuel Generator",
  GeneratorNuclear: "Nuclear Power Plant", GeneratorGeoThermal: "Geothermal Generator",
  WaterPump: "Water Extractor", OilPump: "Oil Extractor", FrackingSmasher: "Resource Well Pressurizer",
  FrackingExtractor: "Resource Well Extractor", ManufacturerMk1: "Manufacturer", OilRefinery: "Refinery",
  HadronCollider: "Particle Accelerator", QuantumEncoder: "Quantum Encoder", Converter: "Converter",
  AwesomeShop: "AWESOME Shop", AwesomeSink: "AWESOME Sink", StorageContainerMk1: "Storage Container",
  StorageContainerMk2: "Industrial Storage Container", StorageIntegrated: "Storage (integrated)",
  PowerPoleMk1: "Power Pole Mk.1", PowerPoleMk2: "Power Pole Mk.2", PowerPoleMk3: "Power Pole Mk.3",
  PowerLine: "Power Line", Pipeline: "Pipeline", PipelinePump: "Pipeline Pump",
  ConveyorAttachmentSplitter: "Conveyor Splitter", ConveyorAttachmentMerger: "Conveyor Merger",
  ConveyorAttachmentSplitterSmart: "Smart Splitter", ConveyorAttachmentSplitterProgrammable: "Programmable Splitter",
  Char_Player: "Player", FGConveyorChainActor: "Conveyor chain",
};
const ARTIFACT = /_RepSize\w+$/;
const PREFIXES = ["Build_", "Desc_", "Recipe_", "BPD_ResearchTree_", "BP_", "Char_", "Schematic_", "Equip_", "Research_", "GP_"];
const FLUIDS = new Set(["Water", "LiquidOil", "HeavyOilResidue", "LiquidFuel", "LiquidTurboFuel", "LiquidBiofuel", "AluminaSolution",
  "SulfuricAcid", "NitricAcid", "NitrogenGas", "RocketFuel", "IonizedFuel", "DissolvedSilica", "DarkEnergy"]);

export const leaf = (p) => (p.includes(".") ? p.slice(p.lastIndexOf(".") + 1) : p.slice(p.lastIndexOf("/") + 1));
const endsC = (s) => (s.endsWith("_C") ? s.slice(0, -2) : s);

export const isFluid = (p) => { let n = endsC(leaf(p)); if (n.startsWith("Desc_")) n = n.slice(5); return FLUIDS.has(n); };

let NAMES = {}; // class name -> the name the player sees, from db_sat/names.json
export const useNames = (table) => { NAMES = table; };

export function schematic(path) {
  if (Object.hasOwn(NAMES, leaf(path))) return NAMES[leaf(path)];
  const m = /^Schematic_(\d+)-(\d+)(?:_C)?$/.exec(leaf(path));
  return m ? `Tier ${m[1]}, Milestone ${m[2]}` : nice(path);
}

export function nice(path) {
  if (Object.hasOwn(NAMES, leaf(path))) return NAMES[leaf(path)];
  let n = endsC(leaf(path)).replace(ARTIFACT, "");
  for (const p of PREFIXES) if (n.startsWith(p)) { n = n.slice(p.length); break; }
  for (const p of ["EqDesc", "EquipmentDescriptor", "Eq_Desc", "EquipmentDesc"])
    if (n.startsWith(p) && n.length > p.length + 1) { n = n.slice(p.length).replace(/^_+/, ""); break; }
  if (Object.hasOwn(OVERRIDES, n)) return OVERRIDES[n];
  n = n.replace(/Mk(\d+)/g, " Mk.$1").replaceAll("_", " ");
  n = n.replace(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, " ");
  return n.replace(/\s+/g, " ").trim();
}

const BUILD_RULES = [
  ["Extraction", ["Miner", "WaterPump", "OilPump", "Fracking", "PortableMiner"]],
  ["Power", ["Generator", "PowerPole", "PowerLine", "PowerTower", "PowerStorage", "PowerSwitch", "PriorityPower", "Xmass"]],
  ["Production", ["Constructor", "Smelter", "Foundry", "Assembler", "Manufacturer", "OilRefinery", "Blender", "Packager",
    "Converter", "HadronCollider", "QuantumEncoder", "Awesome", "SpaceElevator", "Craft", "WorkBench", "Workshop", "TradingPost", "HubTerminal", "ResourceSink"]],
  ["Logistics", ["Conveyor", "Pipeline", "Pipe", "Railroad", "Train", "Drone", "Truck", "Hypertube", "Lift", "Valve", "Junction", "Splitter", "Merger", "Locomotive", "Wagon", "FreightWagon"]],
  ["Storage", ["Storage", "FluidTank", "IndustrialTank", "CentralStorage", "Locker", "DimensionalDepot"]],
];
const STRUCT = ["Foundation", "Wall", "Ramp", "Roof", "Beam", "Pillar", "Ladder", "Fence", "Walkway", "Stair", "Window", "Door"];

export function buildCategory(path) {
  const n = leaf(path);
  for (const [cat, keys] of BUILD_RULES) if (keys.some((k) => n.includes(k))) return cat;
  if (path.includes("/Buildable/Building/") || STRUCT.some((k) => n.includes(k))) return "Structure";
  return "Other";
}
