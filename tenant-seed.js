// tenant-seed.js — first-run contents of the tenant tables.
//
// MAIN PROCESS ONLY; consumed by migrations.js. Kept separate because it is data,
// not schema: migrations.js stays readable, and this file is the thing that gets
// regenerated when the SDK's routing changes.
//
// WHY THIS EXISTS: tenant is a URL-shape concern, not a body field. The AA is
// baked into an SDK deployment at build time (REACT_APP_AACLASS via
// Context.setStrategy), so one host serves one AA; the tenant is chosen at runtime
// from redirect-URL params — orgId, altFlow, version, journeyType. The console
// therefore needs to answer "which params do I append for this tenant", which is a
// different question from "which accountAggregatorId goes in the body".
//
// PRIORITY is the SDK's if/else order, preserved because the routing is ordered:
// altFlow=SLICE_PFM with orgId=MOBIKWIK_FIU_PROD renders Slice, not Mobikwik.
//
// OPERATORS mirror what the SDK actually does, rather than flattening everything
// to equality:
//   EQUALS      - param === value
//   CONTAINS_CI - param.toLowerCase().includes(value)   (creditsaison, DMI)
//   NOT_EQUALS  - guard clauses like altFlow !== 'YB_ASSIST'
//   ABSENT      - param not present in the URL at all
// A flat tenant->params list cannot express these, which is why the rows carry an
// operator column.

'use strict';

const SDK_BUNDLES = [
  ['common-sdk', 'The main bundle: most FIUs route through here.'],
  ['pb-sdk', 'PolicyBazaar family: JIOBLK, JFS, JAR, PaisaBazaar.'],
  ['indmoney-sdk', 'INDmoney only; selects its tenant from sdkVersion.'],
  ['groww-nbt-sdk', 'Groww NBT equities; selects from version + userAgent.'],
  ['dezerv-sdk', 'Dezerv; version=v4 switches to the vendor tenant.'],
];

// name, type, description. `scope` is always a URL query param here — the whole
// point of the distinction from the AA tab.
const PARAMS = [
  ['orgId', 'string', 'Primary tenant discriminator. From ?orgId, or iframe postMessage data.organisationId.'],
  ['altFlow', 'string', 'Secondary discriminator. Any value containing "DMI" is normalised to DMI.'],
  ['version', 'string', 'Tenant variant selector. Read by Mobikwik, CreditSaison, Truebalance, JFS, dezerv, groww-nbt.'],
  ['sdkVersion', 'string', 'indmoney-sdk only. Defaults to v1.'],
  ['journeyType', 'string', 'Journey variant. reacquisition forces MobikwikV2 regardless of version.'],
  ['source', 'string', 'Changes the PAN step for some tenants.'],
  ['platform', 'string', 'web or mobile. Defaults to mobile.'],
  ['aaId', 'string', 'Drives the S3 config path and AA branding, NOT which AA the APIs use.'],
  ['theme', 'string', 'Light/dark stylesheet switch.'],
  ['darkMode', 'string', 'groww-nbt dark switch.'],
  ['tenantDemoType', 'string', 'Demo tenant switch.'],
  ['isYesBankDemo', 'string', 'Yes Bank demo flag.'],
  ['isYesBankDemoPFMJourney', 'string', 'Yes Bank demo PFM flag.'],
  ['redirectBack', 'string', 'encoded or decoded. Defaults to decoded.'],
  ['pdSelected', 'string', 'pb-sdk JFS extra flag.'],
  ['primaryFipId', 'string', 'indmoney extra param.'],
  ['showNoAccountsSkipButton', 'string', 'dezerv vendor extra flag.'],
  ['fiTypes', 'string', 'Pipe-separated per consent handle, comma-separated within.'],
  // Accepted by the SDK but not used to pick a tenant — recorded so the console can
  // still offer every real query param, with its known values, as a suggestion.
  ['consentListEncoded', 'string', 'Encoded consent list.'],
  ['fi', 'string', 'Required for decryptURL() to proceed.'],
  ['topbankstest', 'string', 'Test flag for the top-banks list.'],
  ['reqdate', 'string', 'Required for decryptURL(). Spelled "reqdate", not "regdate".'],
  ['ecreq', 'string', 'Required for decryptURL(); the encrypted request payload.'],
  ['accNo', 'string', 'Account number hint.'],
  ['isMultiFip', 'string', 'true enables multi-FIP.'],
  ['bank', 'string', 'Bank hint.'],
  ['handle', 'string', 'Consent handle.'],
  ['redirectUrl', 'string', 'Post-journey redirect target.'],
  ['customLogo', 'string', 'Overrides the tenant logo.'],
  ['badBanks', 'string', 'Banks to mark unavailable.'],
  ['fipId', 'string', 'Single FIP id.'],
  ['smsToken', 'string', 'SMS token.'],
  ['top8Banks', 'string', 'Top-8 banks override.'],
  ['showDenyButton', 'string', 'false hides the deny button; anything else shows it.'],
  ['singleSelectBanks', 'string', 'Restrict selection to a single bank.'],
  ['autoDiscoveryEnabled', 'string', 'Truthy enables auto-discovery.'],
  ['noOTP', 'string', 'Truthy skips the OTP step.'],
  ['hideEditPhone', 'string', 'true hides the edit-phone control.'],
  ['fipName', 'string', 'FIP display name.'],
  ['bankId', 'string', 'Bank id.'],
];

// Known values per param, independent of any tenant — what the console offers in a
// dropdown when you add a value by hand.
const PARAM_VALUES = {
  version: ['v1', 'v2', 'v3', 'v4', 'v5'],
  sdkVersion: ['v1', 'v2', 'v3'],
  journeyType: ['AUTO_DISCOVERY', 'NORMAL', 'reacquisition', 'multi', 'mandatory', 'non_mandatory', 'add', 'remove', 'refresh'],
  source: ['stocks', 'IND_STOCK_FNO'],
  platform: ['web', 'mobile'],
  aaId: ['onemoney', 'finvu', 'cams', 'nadl', 'saafe', 'anumati'],
  theme: ['light', 'dark'],
  darkMode: ['true', 'false'],
  redirectBack: ['encoded', 'decoded'],
  tenantDemoType: ['piramal'],
  isYesBankDemo: ['true', 'false'],
  isYesBankDemoPFMJourney: ['true', 'false'],
  pdSelected: ['true', 'false'],
  showNoAccountsSkipButton: ['true', 'false'],
  isMultiFip: ['true', 'false'],
  showDenyButton: ['true', 'false'],
  autoDiscoveryEnabled: ['true', 'false'],
  noOTP: ['true', 'false'],
  hideEditPhone: ['true', 'false'],
  singleSelectBanks: ['true', 'false'],
  topbankstest: ['true', 'false'],
  altFlow: [
    'SLICE_PFM', 'ZYNE', 'COMMON_LENDING', 'UPSTOX', 'SIB', 'LNT_PL', 'LNT_PL_V2', 'GST',
    'AXIO', 'FISDOM', 'DMI', 'YB_ASSIST', 'MAHINDRA_PFM', 'PAYME', 'creditsaison',
    'BORROWER_JOURNEY', 'AUBANK', 'PFM', 'COMMON_PFM', 'JIOBLACKROCK', 'MPOKKET', 'FINNY',
    'LOANS_24', 'SLICE_GST', 'COMMON', 'TATA_DIGITAL', 'JFS', 'JAR', 'COMBINED',
  ],
  fiTypes: [
    'DEPOSIT', 'TERM_DEPOSIT', 'RECURRING_DEPOSIT', 'SIP', 'CP', 'GOVT_SECURITIES', 'EQUITIES',
    'BONDS', 'DEBENTURES', 'MUTUAL_FUNDS', 'ETF', 'IDR', 'CIS', 'AIF', 'INSURANCE_POLICIES',
    'NPS', 'INVIT', 'REIT', 'GSTR1_3B', 'LIFE_INSURANCE', 'GENERAL_INSURANCE', 'OTHER',
  ],
};

// [priority, bundle, tenant, component, rules, notes]
// rules: { param: [values] } with EQUALS, or { param: { op: [values] } } for the rest.
const TENANTS = [
  [1, 'common-sdk', 'Slice', 'src/Tenants/Slice', { altFlow: ['SLICE_PFM'] }, ''],
  [2, 'common-sdk', 'Zyne', 'src/Tenants/Zyne', { altFlow: ['ZYNE'], source: ['stocks'] }, 'source=stocks changes the PAN step.'],
  [3, 'common-sdk', 'CommonLendingTenant', 'src/Tenants/CommonLendingTenant', { altFlow: ['COMMON_LENDING', 'UPSTOX'], orgId: ['COMMON_LENDING_FIU_UAT', 'COMMON_LENDING_FIU_PROD'], version: ['v2'] }, 'version=v2 only affects loader style.'],
  [4, 'common-sdk', 'SIB', 'src/Tenants/SIB', { altFlow: ['SIB'], orgId: ['SIB_FIU_UAT', 'SIB_FIU_PROD'] }, ''],
  [5, 'common-sdk', 'LNT', 'src/Tenants/LNT', { altFlow: ['LNT_PL'] }, ''],
  [6, 'common-sdk', 'LNT_V2', 'src/Tenants/LNT_V2', { altFlow: ['LNT_PL_V2'] }, 'Salaried variants read from ?journeyType.'],
  [7, 'common-sdk', 'BharatPe', 'src/Tenants/Bharatpe', { altFlow: ['GST'] }, ''],
  [8, 'common-sdk', 'Axio', 'src/Tenants/Axio', { altFlow: ['AXIO'], orgId: ['CAPFLOAT_FIU_PROD'] }, ''],
  [9, 'common-sdk', 'FisdomV2', 'src/Tenants/FisdomV2', { altFlow: ['FISDOM'], orgId: ['FINWIZARD_FIU_PROD'] }, ''],
  [10, 'common-sdk', 'DMI', 'src/Tenants/DMI', { altFlow: { EQUALS: ['DMI'], CONTAINS_CI: ['DMI'] }, orgId: ['DMI_FIU_PROD'], journeyType: ['multi'] }, 'Any altFlow containing DMI is normalised to DMI.'],
  [11, 'common-sdk', 'YesBankDemo', 'src/Tenants/YesBankDemo', { isYesBankDemo: ['true'], isYesBankDemoPFMJourney: ['true', 'false'] }, 'altFlow=SIB sets the demo flag but the SIB tenant still wins.'],
  [12, 'common-sdk', 'PiramalFinanceDemo', 'src/Tenants/PiramalFinanceDemo', { tenantDemoType: ['piramal'] }, ''],
  [13, 'common-sdk', 'YesBankTenant', 'src/Tenants/YesBankTenant', { orgId: ['YES_BANK_PRIVATE_LTD_FIU_UAT', 'YES_BANK_FIU_PROD'], altFlow: { NOT_EQUALS: ['YB_ASSIST'] } }, ''],
  [14, 'common-sdk', 'MahindraFin', 'src/Tenants/MahindraFin', { altFlow: ['MAHINDRA_PFM'], orgId: ['MAHINDRA_FINANCE_FIU_UAT', 'MAHINDRA_FINANCE_FIU_PROD'], source: ['stocks'], theme: ['dark', 'light'] }, 'theme=dark loads the _DARK css.'],
  [15, 'common-sdk', 'Payme', 'src/Tenants/Payme', { altFlow: ['PAYME'] }, ''],
  [16, 'common-sdk', 'CreditSaison', 'src/Tenants/CreditSaison', { altFlow: ['creditsaison'], orgId: { EQUALS: ['CREDITSAISON_UAT', 'CREDITSAISON_PROD'], CONTAINS_CI: ['creditsaison'] }, version: ['v1', 'v2'] }, 'orgId match is case-insensitive contains.'],
  [17, 'common-sdk', 'Liquiloans', 'src/Tenants/Liquiloans', { altFlow: ['BORROWER_JOURNEY'], orgId: ['LIQUILOANS_PROD', 'NDX_P2P_UAT'] }, ''],
  [18, 'common-sdk', 'Groww', 'src/Tenants/Groww', { orgId: ['ELEMENTS_FIU_UAT', 'GROWW_NBFC_FIU_UAT', 'GCS_FIU_PROD'] }, ''],
  [19, 'common-sdk', 'GrowwNBT', 'src/Tenants/GrowwNBT', { orgId: ['GROWW_NBT_FIU_UAT', 'GROWW_NBT_FIU_PROD'] }, ''],
  [20, 'common-sdk', 'Abcd / AbcdWeb', 'src/Tenants/Abcd | src/Tenants/AbcdWeb', { orgId: ['ABCD_FIU_UAT', 'ADITYA_BIRLA_CAPITAL_DIGITAL_FIU_PROD'] }, 'window.innerWidth >= 1024 renders AbcdWeb, else Abcd.'],
  [21, 'common-sdk', 'Mobikwik', 'src/Tenants/Mobikwik', { orgId: ['MOBIKWIK_FIU_UAT', 'MOBIKWIK_FIU_PROD'], version: { EQUALS: ['v1'], ABSENT: [''] } }, 'Fallback when version is not v2/v3/v4 and journeyType != reacquisition.'],
  [21, 'common-sdk', 'MobikwikV2', 'src/Tenants/MobikwikV2', { orgId: ['MOBIKWIK_FIU_UAT', 'MOBIKWIK_FIU_PROD'], version: ['v2', 'v3'], journeyType: ['reacquisition'], source: ['stocks'] }, 'journeyType=reacquisition forces V2 regardless of version.'],
  [21, 'common-sdk', 'MobikwikV4', 'src/Tenants/MobikwikV4', { orgId: ['MOBIKWIK_FIU_UAT', 'MOBIKWIK_FIU_PROD'], version: ['v4'] }, 'Max OTP resend 3 rather than 10.'],
  [22, 'common-sdk', 'CommonPFM', 'src/Tenants/CommonPFM', { altFlow: { EQUALS: ['AUBANK', 'PFM'], NOT_EQUALS: ['JIOBLACKROCK', 'COMMON_PFM'] }, orgId: ['CHILLAR_FIU_PROD', 'IGNOSIS_COMMON_PFM_FIU_UAT'] }, 'The NOT_EQUALS guard applies to the IGNOSIS/PFM branch.'],
  [23, 'common-sdk', 'PBFintech', 'src/Tenants/PBFintech', { orgId: ['PAISA_BAZAAR_FIU_UAT', 'PAISA_BAZAAR_FIU_PROD'] }, ''],
  [24, 'common-sdk', 'Finsara', 'src/Tenants/Finsara', { orgId: ['FINSARA_FIU_UAT', 'RINKPI_FIU_PROD'] }, ''],
  [25, 'common-sdk', 'StarHealth', 'src/Tenants/StarHealth', { orgId: ['STAR_HEALTH_FIU_UAT', 'STAR_HEALTH_FIU_PROD'] }, ''],
  [26, 'common-sdk', 'LendenClub', 'src/Tenants/LendenClub', { orgId: ['LENDENCLUB_FIU_UAT', 'LENDENCLUB_FIU_PROD', 'LENDENCLUB_PROD'], version: ['v1', 'v2'] }, ''],
  [27, 'common-sdk', 'Truebalance', 'src/Tenants/Truebalance', { orgId: ['TRUEBALANCE_PROD', 'TRUE_BALANCE_FIU_UAT'], version: ['v1', 'v2'] }, ''],
  [28, 'common-sdk', 'MpokketTenant', 'src/Tenants/MpokketTenant', { altFlow: ['MPOKKET'], orgId: ['MPOKKET_FIU_UAT', 'MPOKKET'] }, ''],
  [29, 'common-sdk', 'Supermoney', 'src/Tenants/Supermoney', { orgId: ['SUPERMONEY_FIU_UAT', 'SUPERMONEY_FIU_PROD'] }, ''],
  [30, 'common-sdk', 'Branch', 'src/Tenants/Branch', { orgId: ['BRANCH_FINANCIAL_SERVICES_PRIVATE_LIMITED_FIU_UAT', 'BRANCH_FINANCIAL_SERVICES_PRIVATE_LIMITED_FIU_PROD', 'BRANCH_FIU_UAT', 'BRANCH_FIU_PROD'] }, ''],
  [31, 'common-sdk', 'MoneyView', 'src/Tenants/MoneyView', { orgId: ['MOENYVIEW_LIMITED_FIU_UAT', 'MONEYVIEW_FIU_PROD', 'MONEYVIEWINS_FIU_UAT'] }, ''],
  [32, 'common-sdk', 'Jupiter', 'src/Tenants/Jupiter', { orgId: ['JUPITER_FIU_UAT', 'AFL-NBFC-FIU-260813'] }, ''],
  [33, 'common-sdk', 'Ring', 'src/Tenants/Ring', { orgId: ['RING_FIU_UAT', 'SI_CREVA_FIU_UAT', 'SI_CREVA_FIU_PROD'] }, 'RING_FIU_PROD appears in the Loader but is NOT routed here, so it falls through to Common.'],
  [34, 'common-sdk', 'BajajMarkets', 'src/Tenants/BajajMarkets', { orgId: ['BAJAJ_MARKETS_FIU_UAT', 'BFDL_FIU_PROD'] }, ''],
  [35, 'common-sdk', 'BFL', 'src/Tenants/BFL', { orgId: ['BFL_FIU_UAT', 'BAJAJ_FIU_PROD'], altFlow: { NOT_EQUALS: ['TATA_DIGITAL'] } }, ''],
  [36, 'common-sdk', 'Slice (orgId)', 'src/Tenants/Slice', { orgId: ['SLICE_FIU_UAT', 'NESFB_FIU_PROD'], altFlow: { NOT_EQUALS: ['COMMON'] } }, ''],
  [36, 'common-sdk', 'Slice-GST', 'src/Tenants/Slice-GST', { orgId: ['SLICE_FIU_UAT', 'NESFB_FIU_PROD'], altFlow: ['SLICE_GST'] }, ''],
  [37, 'common-sdk', 'Cashe', 'src/Tenants/Cashe', { orgId: ['CASHE_FIU_UAT', 'BHANIX_FIU_PROD'] }, 'CASHE_FIU_PROD has css but is not routed.'],
  [38, 'common-sdk', 'Finny', 'src/Tenants/Finny', { altFlow: ['FINNY'], orgId: ['FINNY_FIU_UAT', 'FINNY_FIU_PROD', 'TAVAGA_FIU_PROD'] }, ''],
  [39, 'common-sdk', 'AxisBank', 'src/Tenants/AxisBank', { orgId: ['AXIS_FIU_UAT', 'AXIS_FIU_PROD'] }, ''],
  [40, 'common-sdk', 'Loans24', 'src/Tenants/Loans24', { altFlow: ['LOANS_24'], orgId: ['LOANS24_FIU_PROD', 'CARS24_FIU_PROD'] }, 'LOANS24_FIU_UAT is only excluded from the NavBar, not routed here.'],
  [41, 'common-sdk', 'AltCommonTenant', 'src/Tenants/AltCommonTenant', {}, 'Any unmatched orgId, when s3Config.twoPageJourney is true. That comes from S3/fiuConfig, not a query param.'],
  [42, 'common-sdk', 'Common', 'src/Tenants/Common', {}, 'Default fallback for any unmatched orgId.'],

  [1, 'pb-sdk', 'JIOBLK', 'pb-sdk/src/Tenants/JIOBLK', { altFlow: ['JIOBLACKROCK'], orgId: ['JIOBLK_FIU_PROD'] }, ''],
  [2, 'pb-sdk', 'JFS', 'pb-sdk/src/Tenants/JFS', { altFlow: ['JFS'], orgId: ['JFS_FIU_PROD', 'IGNOSIS_COMMON_PFM_FIU_UAT'], version: ['v1', 'v3'], pdSelected: ['true', 'false'] }, 'version=v3 loads jfsNew.css and the new logo.'],
  [3, 'pb-sdk', 'JAR', 'pb-sdk/src/Tenants/JAR', { altFlow: ['JAR'] }, ''],
  [4, 'pb-sdk', 'PaisaBazaar', 'pb-sdk/src/Tenants/PaisaBazaar', { orgId: ['PAISA_BAZAAR_FIU_UAT', 'PAISA_BAZAAR_FIU_PROD'] }, 'Also the default fallback for this bundle.'],

  [1, 'indmoney-sdk', 'IndmoneyV3', 'indmoney-sdk/src/Tenants (Indmoney_V3)', { sdkVersion: ['v3'], orgId: ['INDMONEY_FIU_PROD'] }, 'Default state.'],
  [2, 'indmoney-sdk', 'IndmoneyV2', 'indmoney-sdk/src/Tenants (Indmoney_V2)', { sdkVersion: ['v2'] }, ''],
  [3, 'indmoney-sdk', 'Indmoney', 'indmoney-sdk/src/Tenants (Indmoney)', { sdkVersion: { EQUALS: ['v1'], ABSENT: [''] }, source: ['IND_STOCK_FNO'], primaryFipId: [] }, ''],

  [1, 'groww-nbt-sdk', 'GrowwNBTEquities / WebView', 'groww-nbt-sdk/src/Tenants', { version: ['v2'], orgId: ['GROWW_NBT_FIU_UAT', 'GROWW_NBT_FIU_PROD'], journeyType: ['add', 'remove', 'refresh'], darkMode: ['true', 'false'] }, 'A desktop userAgent renders the WebView variant.'],
  [2, 'groww-nbt-sdk', 'GrowwNBT', 'groww-nbt-sdk/src/Tenants', { version: { EQUALS: ['v1'], ABSENT: [''] }, orgId: ['GROWW_NBT_FIU_UAT', 'GROWW_NBT_FIU_PROD'] }, ''],

  [1, 'dezerv-sdk', 'DezervVendor', 'dezerv-sdk/src/Tenants/DezervVendor', { version: ['v4'], theme: ['light', 'dark'], showNoAccountsSkipButton: ['true', 'false'] }, ''],
  [2, 'dezerv-sdk', 'Dezerv', 'dezerv-sdk/src/Tenants/Dezerv', { version: { EQUALS: ['v1', 'v2', 'v3', 'v5'], ABSENT: [''] } }, ''],
];

// orgIds that only carry a theme — they have no bespoke tenant and fall through to
// Common / AltCommonTenant. Recorded against the fallback tenants so the console
// does not imply they have their own journey.
const THEME_ONLY_ORG_IDS = [
  'WCAPL_FIU_PROD', 'TRILLIONLOANS_UAT', 'TRILLIONLOANS_PROD', 'TATA_MOTORS_FIU_UAT',
  'TATA_MOTORS_FIU_PROD', 'STASHFIN_FIU_UAT', 'SNAPMINT_FIU_PROD', 'SBI_SECURITIES_FIU_UAT',
  'SBI_SECURITIES_FIU_PROD', 'POCKETLY_UAT', 'POCKETLY_PROD', 'Pirimid-TSP-FIU', 'PHFL_FIU_PROD',
  'NDX_P2P_UAT', 'MAHINDRA_FINANCE_FIU_UAT_DARK', 'LT_FINANCE_FIU_UAT', 'LT_FINANCE_FIU_PROD',
  'LIQUILOANS_PROD', 'LENDENCLUB_UAT', 'LAN-NBFC-FIU-260525', 'KBL_FIU_UAT', 'KBL_FIU_PROD',
  'INDIA_SHELTER_UAT', 'IIFL_SAMASTA_FIU_UAT', 'IIFL_SAMASTA_FIU_PROD',
  'IGNOSI_SYSTEM_PRIVATE_LTD_FIU_UAT', 'HINDUJA_FIU_UAT', 'HINDUJA_FIU_PROD',
  'HDFC_SECURITIES_FIU_PROD', 'HDFC_LTD_FIU_UAT', 'HDFCSEC_FIU_UAT', 'GOLDLINE_FIU_UAT',
  'GOLDLINE_FIU_PROD', 'GODREJ_FIU_UAT', 'GODREJ_FINANCE_FIU_UAT', 'GFL-NBFC-FIU-260706',
  'GENWISE_FIU_PROD', 'FREEO_FIU_UAT', 'EVP-NBFC-FIU-260722', 'BOB_CARDS_LIMITED_FIU_UAT',
  'BOB_CARDS_FIU_PROD', 'BHARATAGE_INNOVATION_FIU_UAT', 'BHARATAGE_FIU_UAT', 'BARBFIU',
  'BARBFIU_UAT', 'AYE_FINANCE_FIU_UAT', 'AYE_FINANCE_FIU_PROD', 'AKARA_FIU_PROD',
  'ADANICAPITAL_FIU_UAT', 'ADANICAPITAL_FIU_PROD', 'ACM-NBFC-FIU-260604', 'CASHE_FIU_PROD',
  'RING_FIU_PROD', 'LOANS24_FIU_UAT',
];

module.exports = { SDK_BUNDLES, PARAMS, PARAM_VALUES, TENANTS, THEME_ONLY_ORG_IDS };
