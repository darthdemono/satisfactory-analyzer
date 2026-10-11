"""Readable names and categories from class paths. The player-facing name comes from the table the game ships
(db_sat/names.json, built by tools/gamefiles.py). Classes the table lacks (creatures, integrated buildings, research
trees) fall back to OVERRIDES and then to making the class name readable."""
import re

OVERRIDES = {
    "OreIron": "Iron Ore", "OreCopper": "Copper Ore", "OreGold": "Caterium Ore", "OreBauxite": "Bauxite",
    "OreUranium": "Uranium", "RawQuartz": "Raw Quartz", "Stone": "Limestone", "Cement": "Concrete",
    "Wire": "Wire", "Cable": "Cable", "CopperSheet": "Copper Sheet", "IronPlate": "Iron Plate",
    "IronPlateReinforced": "Reinforced Iron Plate", "ModularFrame": "Modular Frame", "GoldIngot": "Caterium Ingot",
    "Gold": "Caterium Ore", "HogParts": "Hog Remains", "SpitterParts": "Plasma Spitter Remains",
    "StingerParts": "Stinger Remains", "HatcherParts": "Hatcher Remains", "Leaves": "Leaves", "Wood": "Wood",
    "Mycelia": "Mycelia", "Nut": "Paleberry", "Berry": "Berry", "SAM": "SAM Ore", "SAMIngot": "Reanimated SAM",
    "GenericBiomass": "Biomass", "Biofuel": "Solid Biofuel", "LiquidOil": "Crude Oil", "HeavyOilResidue": "Heavy Oil Residue",
    "NuclearFuelRod": "Uranium Fuel Rod", "PetroleumCoke": "Petroleum Coke", "AluminumScrap": "Aluminum Scrap",
    "AluminumPlate": "Alclad Aluminum Sheet", "IronRod": "Iron Rod", "IronScrew": "Screw", "Screw": "Screw",
    "SpaceElevator": "Space Elevator", "TradingPost": "The HUB", "HubTerminal": "HUB Terminal",
    "WorkBench": "Craft Bench", "WorkBenchIntegrated": "Craft Bench (integrated)", "Workshop": "Equipment Workshop",
    "MinerMk1": "Miner Mk.1", "MinerMk2": "Miner Mk.2", "MinerMk3": "Miner Mk.3",
    "GeneratorIntegratedBiomass": "Biomass Burner (integrated)", "GeneratorBiomass_Automated": "Biomass Burner (automated)",
    "GeneratorBiomass": "Biomass Burner", "GeneratorCoal": "Coal Generator", "GeneratorFuel": "Fuel Generator",
    "GeneratorNuclear": "Nuclear Power Plant", "GeneratorGeoThermal": "Geothermal Generator",
    "WaterPump": "Water Extractor", "OilPump": "Oil Extractor", "FrackingSmasher": "Resource Well Pressurizer",
    "FrackingExtractor": "Resource Well Extractor", "ManufacturerMk1": "Manufacturer", "OilRefinery": "Refinery",
    "HadronCollider": "Particle Accelerator", "QuantumEncoder": "Quantum Encoder", "Converter": "Converter",
    "AwesomeShop": "AWESOME Shop", "AwesomeSink": "AWESOME Sink", "StorageContainerMk1": "Storage Container",
    "StorageContainerMk2": "Industrial Storage Container", "StorageIntegrated": "Storage (integrated)",
    "PowerPoleMk1": "Power Pole Mk.1", "PowerPoleMk2": "Power Pole Mk.2", "PowerPoleMk3": "Power Pole Mk.3",
    "PowerLine": "Power Line", "Pipeline": "Pipeline", "PipelinePump": "Pipeline Pump",
    "ConveyorAttachmentSplitter": "Conveyor Splitter", "ConveyorAttachmentMerger": "Conveyor Merger",
    "ConveyorAttachmentSplitterSmart": "Smart Splitter", "ConveyorAttachmentSplitterProgrammable": "Programmable Splitter",
    "Char_Player": "Player", "FGConveyorChainActor": "Conveyor chain",
}
ARTIFACT = re.compile(r"_RepSize\w+$")


def leaf(path):
    return path.rsplit(".", 1)[-1] if "." in path else path.rsplit("/", 1)[-1]


FLUIDS = frozenset(("Water", "LiquidOil", "HeavyOilResidue", "LiquidFuel", "LiquidTurboFuel", "LiquidBiofuel", "AluminaSolution",
                    "SulfuricAcid", "NitricAcid", "NitrogenGas", "RocketFuel", "IonizedFuel", "DissolvedSilica", "DarkEnergy"))


def is_fluid(path):
    return leaf(path).removesuffix("_C").removeprefix("Desc_") in FLUIDS


SCHEMATIC = re.compile(r"^Schematic_(\d+)-(\d+)(?:_C)?$")


def schematic(path):
    """The schematic's own name when the table has it, else Schematic_6-5_C -> Tier 6, Milestone 5."""
    if leaf(path) in NAMES: return NAMES[leaf(path)]
    m = SCHEMATIC.match(leaf(path))
    return f"Tier {m.group(1)}, Milestone {m.group(2)}" if m else nice(path)


NAMES = {}  # class name -> the name the player sees, from db_sat/names.json; use() installs it


def use(table):
    NAMES.clear()
    NAMES.update(table)


def nice(path):
    """/Game/.../Desc_IronPlate.Desc_IronPlate_C -> Iron Plate"""
    if leaf(path) in NAMES: return NAMES[leaf(path)]
    n = ARTIFACT.sub("", leaf(path).removesuffix("_C"))
    for p in ("Build_", "Desc_", "Recipe_", "BPD_ResearchTree_", "BP_", "Char_", "Schematic_", "Equip_", "Research_", "GP_"):
        if n.startswith(p): n = n[len(p):]; break
    for p in ("EqDesc", "EquipmentDescriptor", "Eq_Desc", "EquipmentDesc"):
        if n.startswith(p) and len(n) > len(p) + 1: n = n[len(p):].lstrip("_"); break
    if n in OVERRIDES: return OVERRIDES[n]
    n = re.sub(r"Mk(\d+)", r" Mk.\1", n).replace("_", " ")
    n = re.sub(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", " ", n)
    return re.sub(r"\s+", " ", n).strip()


BUILD_RULES = (
    ("Extraction", ("Miner", "WaterPump", "OilPump", "Fracking", "PortableMiner")),
    ("Power", ("Generator", "PowerPole", "PowerLine", "PowerTower", "PowerStorage", "PowerSwitch", "PriorityPower", "Xmass")),
    ("Production", ("Constructor", "Smelter", "Foundry", "Assembler", "Manufacturer", "OilRefinery", "Blender", "Packager",
                    "Converter", "HadronCollider", "QuantumEncoder", "Awesome", "SpaceElevator", "Craft", "WorkBench", "Workshop", "TradingPost", "HubTerminal", "ResourceSink")),
    ("Logistics", ("Conveyor", "Pipeline", "Pipe", "Railroad", "Train", "Drone", "Truck", "Hypertube", "Lift", "Valve", "Junction", "Splitter", "Merger", "Locomotive", "Wagon", "FreightWagon")),
    ("Storage", ("Storage", "FluidTank", "IndustrialTank", "CentralStorage", "Locker", "DimensionalDepot")),
)


def build_category(path):
    n = leaf(path)
    for cat, keys in BUILD_RULES:
        if any(k in n for k in keys): return cat
    if "/Buildable/Building/" in path or any(k in n for k in ("Foundation", "Wall", "Ramp", "Roof", "Beam", "Pillar", "Ladder", "Fence", "Walkway", "Stair", "Window", "Door")):
        return "Structure"
    return "Other"
