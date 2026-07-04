"use client";

import { useI18n } from "@/lib/i18n/i18n-context";
import { LegalPage, LegalSection, LegalValue, LegalLink } from "@/components/legal/legal-page";
import { useSiteConfig } from "@/lib/site-config";

export default function ImpressumPage() {
  const { locale } = useI18n();
  const config = useSiteConfig();
  return locale === "de" ? <ImpressumDE config={config} /> : <ImpressumEN config={config} />;
}

function ImpressumDE({ config }: { config: ReturnType<typeof useSiteConfig> }) {
  return (
    <LegalPage title="Impressum" updated="Stand: 4. Juli 2026">
      <LegalSection heading="Angaben gemäß § 5 DDG">
        <p>
          FinTrack
          <br />
          <LegalValue value={config.legal_name} placeholder="[VOR- UND NACHNAME]" />
          <br />
          <LegalValue value={config.legal_street} placeholder="[STRASSE UND HAUSNUMMER]" />
          <br />
          <LegalValue value={config.legal_city} placeholder="[PLZ UND ORT]" />
          <br />
          Deutschland
        </p>
      </LegalSection>

      <LegalSection heading="Kontakt">
        <p>
          E-Mail: <LegalValue value={config.legal_email} placeholder="[E-MAIL-ADRESSE]" />
        </p>
      </LegalSection>

      <LegalSection heading="Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV">
        <p>
          <LegalValue value={config.legal_name} placeholder="[VOR- UND NACHNAME]" />
          <br />
          <LegalValue value={config.legal_street} placeholder="[STRASSE UND HAUSNUMMER]" />
          <br />
          <LegalValue value={config.legal_city} placeholder="[PLZ UND ORT]" />
        </p>
      </LegalSection>

      <LegalSection heading="EU-Streitschlichtung">
        <p>
          Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS)
          bereit, die Sie unter{" "}
          <LegalLink href="https://ec.europa.eu/consumers/odr/">
            https://ec.europa.eu/consumers/odr/
          </LegalLink>{" "}
          finden. Unsere E-Mail-Adresse finden Sie oben unter „Kontakt“. Wir sind nicht
          verpflichtet und nicht bereit, an Streitbeilegungsverfahren vor einer
          Verbraucherschlichtungsstelle teilzunehmen.
        </p>
      </LegalSection>

      <LegalSection heading="Haftung für Inhalte">
        <p>
          Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen
          Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 DDG sind wir
          als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte
          fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine
          rechtswidrige Tätigkeit hinweisen. Verpflichtungen zur Entfernung oder Sperrung der
          Nutzung von Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt.
          Eine diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der Kenntnis einer
          konkreten Rechtsverletzung möglich. Bei Bekanntwerden von entsprechenden
          Rechtsverletzungen werden wir diese Inhalte umgehend entfernen.
        </p>
      </LegalSection>

      <LegalSection heading="Haftung für Links">
        <p>
          Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir
          keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine
          Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige
          Anbieter oder Betreiber der Seiten verantwortlich. Die verlinkten Seiten wurden zum
          Zeitpunkt der Verlinkung auf mögliche Rechtsverstöße überprüft. Rechtswidrige
          Inhalte waren zum Zeitpunkt der Verlinkung nicht erkennbar. Eine permanente
          inhaltliche Kontrolle der verlinkten Seiten ist jedoch ohne konkrete Anhaltspunkte
          einer Rechtsverletzung nicht zumutbar. Bei Bekanntwerden von Rechtsverletzungen
          werden wir derartige Links umgehend entfernen.
        </p>
      </LegalSection>
    </LegalPage>
  );
}

function ImpressumEN({ config }: { config: ReturnType<typeof useSiteConfig> }) {
  return (
    <LegalPage title="Imprint" updated="Last updated: 4 July 2026">
      <p className="text-xs text-zinc-500">
        This page is a courtesy translation. The legally binding version, required under
        German law (§ 5 DDG), is the{" "}
        <a href="/impressum" className="underline underline-offset-2">
          German original
        </a>{" "}
        (switch the language selector to view it).
      </p>

      <LegalSection heading="Information pursuant to § 5 DDG (German Digital Services Act)">
        <p>
          FinTrack
          <br />
          <LegalValue value={config.legal_name} placeholder="[FIRST AND LAST NAME]" />
          <br />
          <LegalValue value={config.legal_street} placeholder="[STREET AND HOUSE NUMBER]" />
          <br />
          <LegalValue value={config.legal_city} placeholder="[POSTAL CODE AND CITY]" />
          <br />
          Germany
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Email: <LegalValue value={config.legal_email} placeholder="[EMAIL ADDRESS]" />
        </p>
      </LegalSection>

      <LegalSection heading="Responsible for content pursuant to § 18(2) MStV (German Interstate Media Treaty)">
        <p>
          <LegalValue value={config.legal_name} placeholder="[FIRST AND LAST NAME]" />
          <br />
          <LegalValue value={config.legal_street} placeholder="[STREET AND HOUSE NUMBER]" />
          <br />
          <LegalValue value={config.legal_city} placeholder="[POSTAL CODE AND CITY]" />
        </p>
      </LegalSection>

      <LegalSection heading="EU Online Dispute Resolution">
        <p>
          The European Commission provides a platform for online dispute resolution (ODR),
          available at{" "}
          <LegalLink href="https://ec.europa.eu/consumers/odr/">
            https://ec.europa.eu/consumers/odr/
          </LegalLink>
          . Our email address is listed above under &ldquo;Contact&rdquo;. We are not
          obliged and not willing to take part in dispute resolution proceedings before a
          consumer arbitration board.
        </p>
      </LegalSection>

      <LegalSection heading="Liability for content">
        <p>
          As a service provider, we are responsible for our own content on these pages
          under the general laws pursuant to § 7(1) DDG. However, pursuant to §§ 8 to 10
          DDG, we are not obliged to monitor transmitted or stored third-party information
          or to investigate circumstances that indicate illegal activity. Obligations to
          remove or block the use of information under general law remain unaffected.
          However, liability in this regard is only possible from the point in time at
          which a specific infringement becomes known. Upon becoming aware of any such
          infringements, we will remove this content immediately.
        </p>
      </LegalSection>

      <LegalSection heading="Liability for links">
        <p>
          Our site contains links to external third-party websites over whose content we
          have no influence. Therefore, we cannot accept any liability for this external
          content. The respective provider or operator of the linked pages is always
          responsible for their content. The linked pages were checked for possible legal
          violations at the time of linking. No illegal content was identifiable at that
          time. Permanent monitoring of the content of linked pages is not reasonable
          without concrete evidence of an infringement. We will remove such links
          immediately upon becoming aware of any infringements.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
