import { describe, expect, it } from "vitest";
import { translateSliceLabel } from "../lib/i18n/slice-label";
import { translate } from "../lib/i18n/dictionaries";

const tEn = (key: Parameters<typeof translate>[1]) => translate("en", key);
const tDe = (key: Parameters<typeof translate>[1]) => translate("de", key);

describe("translateSliceLabel", () => {
  it("translates asset classes via the existing assetType.* keys", () => {
    expect(translateSliceLabel("STOCK", tEn)).toBe("Stock");
    expect(translateSliceLabel("STOCK", tDe)).toBe("Aktie");
    expect(translateSliceLabel("ETF", tDe)).toBe("ETF");
    expect(translateSliceLabel("CRYPTO", tDe)).toBe("Kryptowährung");
    expect(translateSliceLabel("COMMODITY", tDe)).toBe("Rohstoff");
    expect(translateSliceLabel("CASH", tDe)).toBe("Bargeld");
  });

  it("translates volatility bands, keeping the numeric range", () => {
    expect(translateSliceLabel("Low (<15%)", tDe)).toBe("Niedrig (<15%)");
    expect(translateSliceLabel("Medium (15-30%)", tDe)).toBe("Mittel (15-30%)");
    expect(translateSliceLabel("High (30-60%)", tDe)).toBe("Hoch (30-60%)");
    expect(translateSliceLabel("Very high (>60%)", tDe)).toBe("Sehr hoch (>60%)");
  });

  it("translates sentinel buckets", () => {
    expect(translateSliceLabel("Untagged", tDe)).toBe("Ohne Tag");
    expect(translateSliceLabel("Unknown", tDe)).toBe("Unbekannt");
    expect(translateSliceLabel("Other", tDe)).toBe("Andere");
    expect(translateSliceLabel("Commodities", tDe)).toBe("Rohstoffe");
    expect(translateSliceLabel("Digital Assets", tDe)).toBe("Digitale Assets");
    expect(translateSliceLabel("Crypto", tDe)).toBe("Krypto");
  });

  it("translates the lookThrough sector/region 'Cash' bucket (title case, distinct from the byAssetClass 'CASH')", () => {
    expect(translateSliceLabel("Cash", tDe)).toBe("Bargeld");
    expect(translateSliceLabel("Cash", tEn)).toBe("Cash");
  });

  it("translates both the Yahoo and GICS sector vocabularies, kept distinguishable", () => {
    // Yahoo raw names.
    expect(translateSliceLabel("Technology", tDe)).toBe("Technologie");
    expect(translateSliceLabel("Financial Services", tDe)).toBe("Finanzdienstleistungen");
    expect(translateSliceLabel("Healthcare", tDe)).toBe("Gesundheit");
    expect(translateSliceLabel("Consumer Cyclical", tDe)).toBe("Zyklischer Konsum");
    expect(translateSliceLabel("Consumer Defensive", tDe)).toBe("Basiskonsum");
    expect(translateSliceLabel("Basic Materials", tDe)).toBe("Grundstoffe");
    // GICS-style names (lib/server/classify.ts SECTOR_MAP output).
    expect(translateSliceLabel("Information Technology", tDe)).toBe("Informationstechnologie");
    expect(translateSliceLabel("Consumer Discretionary", tDe)).toBe("Zyklische Konsumgüter");
    expect(translateSliceLabel("Consumer Staples", tDe)).toBe("Basiskonsumgüter");
    expect(translateSliceLabel("Financials", tDe)).toBe("Finanzwesen");
    expect(translateSliceLabel("Health Care", tDe)).toBe("Gesundheitswesen");
    expect(translateSliceLabel("Materials", tDe)).toBe("Materialien");
    // Shared between both vocabularies.
    expect(translateSliceLabel("Communication Services", tDe)).toBe("Kommunikationsdienste");
    expect(translateSliceLabel("Industrials", tDe)).toBe("Industrie");
    expect(translateSliceLabel("Energy", tDe)).toBe("Energie");
    expect(translateSliceLabel("Utilities", tDe)).toBe("Versorger");
    expect(translateSliceLabel("Real Estate", tDe)).toBe("Immobilien");

    // The two vocabularies for the "same" sector stay distinguishable, not merged.
    expect(translateSliceLabel("Technology", tDe)).not.toBe(
      translateSliceLabel("Information Technology", tDe),
    );
    expect(translateSliceLabel("Consumer Discretionary", tDe)).not.toBe(
      translateSliceLabel("Consumer Cyclical", tDe),
    );
  });

  it("translates regions that occur in the codebase/seed data", () => {
    expect(translateSliceLabel("North America", tDe)).toBe("Nordamerika");
    expect(translateSliceLabel("Europe", tDe)).toBe("Europa");
    expect(translateSliceLabel("Asia-Pacific", tDe)).toBe("Asien-Pazifik");
    expect(translateSliceLabel("Latin America", tDe)).toBe("Lateinamerika");
    expect(translateSliceLabel("Global", tDe)).toBe("Global");
    expect(translateSliceLabel("Middle East & Africa", tDe)).toBe("Naher Osten & Afrika");
    expect(translateSliceLabel("Cash & other", tDe)).toBe("Bargeld & Sonstiges");
    // Common Yahoo region names not currently emitted by our own classifier,
    // covered defensively.
    expect(translateSliceLabel("Asia", tDe)).toBe("Asien");
    expect(translateSliceLabel("Japan", tDe)).toBe("Japan");
    expect(translateSliceLabel("Emerging Markets", tDe)).toBe("Schwellenländer");
    expect(translateSliceLabel("Africa", tDe)).toBe("Afrika");
    expect(translateSliceLabel("Oceania", tDe)).toBe("Ozeanien");
    expect(translateSliceLabel("Middle East", tDe)).toBe("Naher Osten");
  });

  it("passes unknown labels through verbatim (country names, investment names, tag values)", () => {
    expect(translateSliceLabel("Germany", tDe)).toBe("Germany");
    expect(translateSliceLabel("Apple Inc.", tDe)).toBe("Apple Inc.");
    expect(translateSliceLabel("gamble", tDe)).toBe("gamble");
    expect(translateSliceLabel("EUR", tDe)).toBe("EUR");
  });
});
