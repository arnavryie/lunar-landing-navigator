// Authoritative scientific data for the 9 NASA Artemis III Candidate Landing Regions
// Announced by NASA (Oct 28, 2024), downselected from 13 candidate zones.
// Grounded in NASA LRO (LOLA, Diviner, LEND, LAMP), LCROSS impact spectrometry, and Chandrayaan-1 M3 data.

export interface ArtemisSiteData {
  id: string
  name: string
  lat: number
  lon: number
  elevation_km: number
  geology: string
  minerals: {
    primary: string[]
    details: string
    crust_type: string
  }
  resources: {
    water_ice_potential: 'Very High' | 'Exceptional' | 'High' | 'Strategic'
    water_ice_details: string
    depth_estimate: string
    volatiles: string[]
    isru_elements: string[]
    isru_applications: string
  }
  operations: {
    illumination: string
    earth_comms: string
    strategic_value: string
  }
  source: string
  source_url: string
}

export const ARTEMIS_3_SITES: ArtemisSiteData[] = [
  {
    id: 'cabeus-b',
    name: 'Peak near Cabeus B',
    lat: -83.59,
    lon: -68.6,
    elevation_km: 2.8,
    geology: 'Prominent elevated massif flanking Cabeus crater. Formed by ancient impact uplift, exposing deep crustal bedrock above surrounding cryogenic depressions.',
    minerals: {
      primary: ['Ferroan Anorthosite (FAN)', 'Plagioclase Feldspar (CaAl₂Si₂O₈)', 'Orthopyroxene', 'Ilmenite (FeTiO₃)'],
      details: 'High-purity anorthosite (>85% calcic plagioclase) representing primordial magma-ocean crust, blended with impact melt breccia from the South Pole-Aitken (SPA) basin.',
      crust_type: 'Primordial Highland Anorthosite',
    },
    resources: {
      water_ice_potential: 'Exceptional',
      water_ice_details: 'Directly overlooks Cabeus crater where the 2009 NASA LCROSS mission impacted, measuring 5.5 ± 1.4 wt% water ice in the ejected plume alongside volatile carbon and nitrogen compounds.',
      depth_estimate: 'Surface frost in PSR cold traps; 10–30 cm subsurface ice under dry regolith mantle.',
      volatiles: ['H₂O (Water Ice)', 'CO₂ (Carbon Dioxide)', 'CH₄ (Methane)', 'NH₃ (Ammonia)', 'H₂S (Hydrogen Sulfide)', 'CO (Carbon Monoxide)'],
      isru_elements: ['Oxygen (41–45 wt% bound in silicates)', 'Hydrogen', 'Aluminum', 'Silicon', 'Calcium'],
      isru_applications: 'Cryogenic rocket propellant (LH₂/LOX), crew life support (breathing O₂ and potable H₂O), and aluminum/calcium structural alloys.',
    },
    operations: {
      illumination: '~65% illumination during lunar southern summer on the ridge crest.',
      earth_comms: '~55% direct-to-Earth line of sight, periodic libration occultations.',
      strategic_value: 'Direct ground-truth access to the most chemically verified volatile reservoir on the Moon.',
    },
    source: 'NASA Artemis III Site Downselection (Oct 2024); LCROSS Impact Spectrometry (Colaprete et al., Science 2010)',
    source_url: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/',
  },
  {
    id: 'haworth',
    name: 'Haworth',
    lat: -86.73,
    lon: -22.7,
    elevation_km: 1.5,
    geology: 'Rugged crater rim crest rising above the floor of Haworth crater (35 km diameter), one of the coldest continuous cryogenic traps in the solar system.',
    minerals: {
      primary: ['Anorthositic Norite', 'Magnesian Pyroxene', 'Plagioclase', 'Olivine trace'],
      details: 'Feldspathic highlands regolith blended with SPA impact melt. Deep shadowed floors prevent solar wind space weathering, preserving pristine crystalline structures.',
      crust_type: 'Highland Feldspathic & SPA Melt',
    },
    resources: {
      water_ice_potential: 'Very High',
      water_ice_details: 'LEND neutron suppression indicates 0.8–1.5 wt% water-equivalent hydrogen (WEH). Crater interior temperatures drop to 38 K, acting as an ultra-cold volatile sink.',
      depth_estimate: '15–40 cm below surface; stable surface frost detected by M³ infrared reflectance.',
      volatiles: ['H₂O', 'CO₂', 'Organics', 'OH (Hydroxyl radicals)'],
      isru_elements: ['Oxygen', 'Hydrogen', 'Silicon', 'Iron', 'Magnesium'],
      isru_applications: 'Water mining for propellant; regolith microwave sintering for landing pads and blast walls.',
    },
    operations: {
      illumination: '~60–70% annual illumination on the rim peak; low solar grazing angles.',
      earth_comms: '~60% direct-to-Earth visibility; favorable during northern lunar libration.',
      strategic_value: 'Short robotic sortie route from sunlit rim down into permanent shadow for sampling.',
    },
    source: 'NASA Artemis III Site Downselection (Oct 2024); LRO LEND/LAMP Polar Survey (Mazarico et al., 2011)',
    source_url: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/',
  },
  {
    id: 'malapert-massif',
    name: 'Malapert Massif',
    lat: -85.96,
    lon: -0.2,
    elevation_km: 5.0,
    geology: 'Colossal 5,000-meter mountain peak (Malapert Mountain). Represents deep crustal and upper-mantle uplift caused by the cataclysmic South Pole-Aitken basin impact.',
    minerals: {
      primary: ['Anorthosite', 'Low-Ca Pyroxene (Enstatite)', 'Ilmenite (FeTiO₃)', 'Spinel trace'],
      details: 'Deep lunar crustal rocks uplifted from depths >30 km. Enriched in ilmenite compared to typical polar highland crust.',
      crust_type: 'Deep Crustal / SPA Basin Ejecta',
    },
    resources: {
      water_ice_potential: 'Strategic',
      water_ice_details: 'Adjacent to micro-cold traps along mountain slopes. Serves as high-ground hub overlooking volatile deposits in Haworth and Shoemaker.',
      depth_estimate: 'Patchy subsurface deposits in shadowed crevices.',
      volatiles: ['H₂O (in micro-cold traps)', 'Trapped solar wind H₂ and ⁴He'],
      isru_elements: ['Titanium (from Ilmenite)', 'Iron (native Fe and FeO)', 'Oxygen (43 wt%)', 'Silicon'],
      isru_applications: 'High-yield hydrogen reduction of ilmenite for oxygen and metallic iron; ideal site for primary lunar surface power & comms infrastructure.',
    },
    operations: {
      illumination: '>75% annual sunlight; summits remain illuminated for months continuously.',
      earth_comms: '>85–90% direct-to-Earth visibility due to prime 0° longitude location facing Earth.',
      strategic_value: 'The premier location for a permanent lunar base, power station, and Earth communications relay.',
    },
    source: 'NASA Artemis III Site Downselection (Oct 2024); Goldstone Radar & LRO Topography (Margot et al., 1999)',
    source_url: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/',
  },
  {
    id: 'mouton-plateau',
    name: 'Mons Mouton Plateau',
    lat: -84.28,
    lon: 30.7,
    elevation_km: 6.0,
    geology: 'Vast, flat-topped mesa structure towering 6 km above surrounding terrain. Pre-Nectarian highland plateau providing large, low-slope touchdown ellipses.',
    minerals: {
      primary: ['Ferroan Anorthosite (FAN)', 'Plagioclase (>90%)', 'Clinopyroxene', 'Agglutinitic Glass'],
      details: 'Extremely pristine highland feldspathic crust with low iron (<4 wt% FeO) and low titanium (<0.5 wt% TiO₂).',
      crust_type: 'Pre-Nectarian Highland Plateau',
    },
    resources: {
      water_ice_potential: 'High',
      water_ice_details: 'Subsurface hydrogen detected along plateau perimeter depressions and in shadowed micro-craters.',
      depth_estimate: '20–50 cm depth beneath regolith.',
      volatiles: ['H₂O ice', 'Hydroxyl-bearing minerals', 'Solar-wind implanted gases'],
      isru_elements: ['Aluminum (high purity)', 'Silicon (solar panel production)', 'Oxygen (45 wt%)', 'Calcium'],
      isru_applications: 'Purified silicon extraction for in-situ photovoltaic solar cells; aluminum for structural frameworks; wide flat expanses for landing pads.',
    },
    operations: {
      illumination: '~65–70% solar availability with broad horizon clearance.',
      earth_comms: '~60–65% direct-to-Earth line of sight.',
      strategic_value: 'Safest landing terrain with minimal slope hazards; vast space for base and habitat expansion.',
    },
    source: 'NASA Artemis III Site Downselection (Oct 2024); LROC NAC Digital Terrain Models',
    source_url: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/',
  },
  {
    id: 'mons-mouton',
    name: 'Mons Mouton',
    lat: -85.38,
    lon: 31.8,
    elevation_km: 5.5,
    geology: 'The sharp southern ridge crest of the Mons Mouton mountain complex. Features dramatic elevation drops into permanently shadowed cryogenic valleys.',
    minerals: {
      primary: ['Anorthositic Breccia', 'Shock-metamorphosed Feldspar', 'Norite', 'Pyroxene'],
      details: 'Impact-brecciated highland rock with shock veins and melt sheets from early heavy bombardment.',
      crust_type: 'Brecciated Highland Uplift',
    },
    resources: {
      water_ice_potential: 'Very High',
      water_ice_details: 'Extreme micro-climate: peak receives prolonged solar warming while adjacent deep fissures remain at <45 K, capable of trapping volatile hydrocarbons.',
      depth_estimate: 'Surface frost in immediate adjacent fissures; 15 cm subsurface.',
      volatiles: ['H₂O', 'CO₂', 'CH₄', 'NH₃', 'Noble gases'],
      isru_elements: ['Oxygen', 'Silicon', 'Aluminum', 'Iron'],
      isru_applications: 'Solar thermal power generation on ridge; short-distance tethered extraction of volatile chemicals.',
    },
    operations: {
      illumination: '~70–75% annual sunlight along the narrow crest.',
      earth_comms: '~60% direct-to-Earth visibility.',
      strategic_value: 'Immediate dual-environment access: maximum solar energy coupled with shortest traverse to deep cryogenic cold traps.',
    },
    source: 'NASA Artemis III Site Downselection (Oct 2024); LRO Diviner Thermal Radiometer',
    source_url: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/',
  },
  {
    id: 'nobile-1',
    name: 'Nobile Rim 1',
    lat: -85.41,
    lon: 37.5,
    elevation_km: 3.2,
    geology: 'Northern rim crest of Nobile crater (73 km diameter). Designated as the scientific study region for the NASA VIPER (Volatiles Investigating Polar Exploration Rover).',
    minerals: {
      primary: ['Highland Anorthosite', 'Noritic Impact Melt', 'Olivine', 'Pyroxene (Enstatite & Augite)'],
      details: 'Heterogeneous mix of ancient SPA basin ejecta and Nobile impact excavation, containing deep-seated plutonic rocks.',
      crust_type: 'Complex Impact Crater Rim',
    },
    resources: {
      water_ice_potential: 'Exceptional',
      water_ice_details: 'Primary candidate for shallow, drill-accessible subsurface water ice. Diviner confirms thermal stability <110 K at depths as shallow as 15 cm.',
      depth_estimate: '15–30 cm subsurface, protected by dry regolith blanket.',
      volatiles: ['H₂O Ice (granular & pore-filling)', 'OH', 'CO₂', 'Trace methane'],
      isru_elements: ['Oxygen', 'Hydrogen', 'Iron', 'Silicon', 'Titanium'],
      isru_applications: 'Target site for first multi-kilogram ice core drilling, mechanical extraction, and water purification demonstrations.',
    },
    operations: {
      illumination: '~60–65% solar availability across the rolling rim terrain.',
      earth_comms: '~55–60% direct-to-Earth contact.',
      strategic_value: 'Highest scientific priority for validating subsurface water ice distribution models and regolith drilling.',
    },
    source: 'NASA VIPER Science Team & Artemis III Downselection (Oct 2024); Colaprete et al., LPSC 2022',
    source_url: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/',
  },
  {
    id: 'nobile-2',
    name: 'Nobile Rim 2',
    lat: -83.9,
    lon: 58.8,
    elevation_km: 2.1,
    geology: 'The eastern rim of Nobile crater featuring gentle slopes, low rock abundance, and rolling topography suitable for extended rover traverses.',
    minerals: {
      primary: ['Feldspathic Impact Melt Breccia', 'Plagioclase', 'Pyroxene', 'Ilmenite'],
      details: 'Regolith formed from multiple overlapping impact events, well-gardened by micrometeorite impacts, rich in fine agglutinates.',
      crust_type: 'Highland Impact Regolith',
    },
    resources: {
      water_ice_potential: 'High',
      water_ice_details: 'Subsurface cold traps in local small craters (<1 km); Chandrayaan-1 M³ spectral absorption bands at 1.5 µm and 2.0 µm indicate frost.',
      depth_estimate: '25–50 cm depth.',
      volatiles: ['H₂O', 'Hydroxyl (OH)', 'Solar-wind Hydrogen'],
      isru_elements: ['Silicon', 'Aluminum', 'Iron', 'Oxygen', 'Magnesium'],
      isru_applications: 'Easy excavation and bulk regolith civil engineering: berms, roads, and sintered habitat shielding.',
    },
    operations: {
      illumination: '~60% solar coverage; moderate seasonal variance.',
      earth_comms: '~60% direct-to-Earth visibility; stable eastern libration window.',
      strategic_value: 'Excellent mobility corridor for long-range pressurized rover expeditions between Nobile and Amundsen.',
    },
    source: 'NASA Artemis III Site Downselection (Oct 2024); Chandrayaan-1 M³ Data (Pieters et al., 2009)',
    source_url: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/',
  },
  {
    id: 'de-gerlache-2',
    name: 'de Gerlache Rim 2',
    lat: -88.22,
    lon: -64.3,
    elevation_km: 3.8,
    geology: 'Ultra-high-latitude elevated ridge on the southern rim of de Gerlache crater, positioned within 60 km of the true lunar South Pole and Shackleton crater.',
    minerals: {
      primary: ['Pristine Ferroan Anorthosite', 'Pure Plagioclase (An₉₆)', 'Trace Pyroxene', 'Solar-wind implanted elements'],
      details: 'Ultra-ancient primordial highland crust preserved with virtually zero space weathering in shadowed sections.',
      crust_type: 'Primordial Polar Highlands',
    },
    resources: {
      water_ice_potential: 'Very High',
      water_ice_details: 'Mini-RF and Mini-SAR radar show elevated circular polarization ratio (CPR) consistent with sheets of subsurface water ice in the adjacent de Gerlache interior.',
      depth_estimate: '10–20 cm subsurface; surface ice in crater shadow.',
      volatiles: ['H₂O', 'Helium-3 (³He from solar wind)', 'Hydrogen', 'Nitrogen'],
      isru_elements: ['Oxygen (45 wt%)', 'Hydrogen', 'Aluminum', 'Helium-3 (fusion fuel)'],
      isru_applications: 'Life-support consumables (water, oxygen), fuel production, and solar-wind implanted Helium-3 extraction.',
    },
    operations: {
      illumination: '~65–70% grazing sunlight circling the horizon 360° continuously during summer.',
      earth_comms: '~50–55% direct-to-Earth visibility with libration modulation.',
      strategic_value: 'Gateway ridge to the true South Pole and the Shackleton-de Gerlache connecting ridge.',
    },
    source: 'NASA Artemis III Site Downselection (Oct 2024); Mini-RF LRO Radar Investigations (Spudis et al., 2013)',
    source_url: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/',
  },
  {
    id: 'slater-plain',
    name: 'Slater Plain',
    lat: -87.14,
    lon: 125.2,
    elevation_km: 1.2,
    geology: 'Inter-crater plain between Slater, Faustini, and Amundsen craters. Broad expanse of smooth impact melt and thick regolith blanket.',
    minerals: {
      primary: ['Pyroxene (Augite & Pigeonite)', 'Plagioclase', 'Olivine', 'Ilmenite', 'Volcanic & Impact Glass'],
      details: 'Regolith developed over SPA impact melt sheet, showing higher FeO content (~6–8 wt%) than typical highlands.',
      crust_type: 'SPA Inter-Crater Melt Plain',
    },
    resources: {
      water_ice_potential: 'High',
      water_ice_details: 'Flanked by Faustini crater (one of the highest confirmed water concentrations from LRO LAMP UV reflectance). Low annual temperatures (~70 K) keep subsurface ice stable.',
      depth_estimate: '20–40 cm below surface.',
      volatiles: ['H₂O', 'Carbon monoxide', 'Hydroxyl'],
      isru_elements: ['Iron (6–8 wt%)', 'Silicon', 'Aluminum', 'Oxygen', 'Titanium'],
      isru_applications: 'High iron content facilitates magnetic separation for metallic 3D printing; flat topography allows massive solar arrays.',
    },
    operations: {
      illumination: '~55–60% solar exposure; broad open sky view.',
      earth_comms: '~50% direct-to-Earth contact; requires libration tracking.',
      strategic_value: 'Expansive flat staging ground for heavy cargo landers and surface nuclear power plants.',
    },
    source: 'NASA Artemis III Site Downselection (Oct 2024); LRO LAMP UV Polar Frost Detection (Hayne et al., 2015)',
    source_url: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/',
  },
]
