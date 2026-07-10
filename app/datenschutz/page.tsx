"use client";

import { useI18n } from "@/lib/i18n/i18n-context";
import {
  LegalPage,
  LegalSection,
  LegalValue,
  EmailImage,
  LegalLink,
} from "@/components/legal/legal-page";
import { useSiteConfig } from "@/lib/site-config";

export default function DatenschutzPage() {
  const { locale } = useI18n();
  const config = useSiteConfig();
  return locale === "de" ? <DatenschutzDE config={config} /> : <DatenschutzEN config={config} />;
}

function DatenschutzDE({ config }: { config: ReturnType<typeof useSiteConfig> }) {
  return (
    <LegalPage title="Datenschutzerklärung" updated="Stand: 4. Juli 2026">
      <LegalSection heading="1. Verantwortlicher">
        <p>
          Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) ist der im{" "}
          <LegalLink href="/impressum">Impressum</LegalLink> genannte Betreiber:
        </p>
        <p>
          <LegalValue value={config.legal_name} placeholder="[VOR- UND NACHNAME]" />
          <br />
          <LegalValue value={config.legal_street} placeholder="[STRASSE UND HAUSNUMMER]" />
          <br />
          <LegalValue value={config.legal_city} placeholder="[PLZ UND ORT]" />
          <br />
          E-Mail:{" "}
          <EmailImage
            value={config.legal_email}
            placeholder="[E-MAIL-ADRESSE]"
            label="E-Mail-Adresse (als Bild angezeigt zum Schutz vor Spam)"
          />
        </p>
      </LegalSection>

      <LegalSection heading="2. Gastmodus: Daten bleiben im Browser">
        <p>
          FinTrack kann ohne Registrierung im „Gastmodus“ genutzt werden. In diesem Modus
          verlassen Ihre Portfoliodaten (Positionen, Transaktionen, Einstellungen) Ihren
          Browser zu keinem Zeitpunkt. Sie werden ausschließlich im{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800">
            localStorage
          </code>{" "}
          Ihres Geräts gespeichert. Wir haben keinen Zugriff darauf, und es wird nichts an
          einen Server übertragen. Löschen Sie den Browserspeicher, sind die Daten
          unwiderruflich weg.
        </p>
      </LegalSection>

      <LegalSection heading="3. Registrierter Modus: Hosting, Datenbank und Konto">
        <p>
          Im registrierten Modus verarbeiten wir Ihre Portfoliodaten sowie Ihre
          Konto-Anmeldedaten über <strong>Supabase</strong> (Authentifizierung und
          PostgreSQL-Datenbank). Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Erfüllung
          des Nutzungsvertrags, den Sie durch die Registrierung mit uns eingehen).
        </p>
        <p>
          Zur Anmeldung setzen wir technisch notwendige Auth-Cookies von Supabase, die Ihre
          Sitzung verwalten. Diese Cookies sind für den Betrieb des Kontos zwingend
          erforderlich und unterliegen keinem Einwilligungsvorbehalt (§ 25 Abs. 2 Nr. 2
          TTDSG/DDG, Art. 6 Abs. 1 lit. b DSGVO).
        </p>
        <p>
          Sie können sich mit E-Mail/Passwort oder über die Anbieter <strong>Google</strong>{" "}
          bzw. <strong>GitHub</strong> (OAuth) anmelden. Bei der OAuth-Anmeldung werden Sie
          auf die Seite des jeweiligen Anbieters weitergeleitet und melden sich dort an.
          Welche Daten dabei verarbeitet werden, unterliegt der Datenschutzerklärung des
          jeweiligen Anbieters (Google bzw. GitHub), nicht dieser Erklärung. Wir erhalten
          von diesen Anbietern lediglich die zur Kontoerstellung nötigen Basisdaten (z. B.
          E-Mail-Adresse).
        </p>
      </LegalSection>

      <LegalSection heading="4. Marktdaten: Kurse und Wechselkurse">
        <p>
          FinTrack zeigt Kurse, Kursverläufe und Wechselkurse an. Diese Daten werden von
          unserem Server, <strong>nicht von Ihrem Browser</strong>, abgerufen: bei den
          Anbietern Yahoo Finance, Stooq, CoinGecko und Frankfurter (EZB-Wechselkurse).
        </p>
        <p>
          Das bedeutet konkret: Ihr Browser sendet eine Anfrage an unseren eigenen Server
          (z. B. „aktuellen Kurs für dieses ISIN/Symbol abrufen“); erst unser Server
          kontaktiert die genannten Drittanbieter. <strong>Ihre IP-Adresse wird diesen
          Anbietern dabei nicht offengelegt</strong>. Sie sehen nur die IP-Adresse unseres
          Servers. Übermittelt werden ausschließlich Instrumentenkennungen (ISIN, Symbol
          bzw. Kryptowährungs-ID) und ggf. die Zielwährung, keine auf Sie persönlich
          beziehbaren Daten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes
          Interesse an der Bereitstellung der Kernfunktion der App).
        </p>
      </LegalSection>

      <LegalSection heading="5. Speicherung, Cookies und lokaler Speicher">
        <p>
          Wir setzen ausschließlich technisch notwendige Cookies und lokalen Speicher ein,
          <strong> keine Analyse-, Marketing- oder Tracking-Cookies</strong> Dritter:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Supabase-Auth-Cookies (registrierter Modus, Sitzungsverwaltung).</li>
          <li>
            <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800">
              localStorage
            </code>{" "}
            für: Portfoliodaten im Gastmodus, die gewählte Sprache, den Anzeige-Modus
            (Beträge ein-/ausblenden), Ihre eigenen Tags sowie einen Zwischenspeicher des
            Instrumenten-Katalogs (schnelleres Laden, keine personenbezogenen Daten).
          </li>
        </ul>
        <p>
          Wir binden keine Analyse- oder Tracking-Dienste Dritter ein. Schriftarten werden
          selbst gehostet (kein Nachladen von Google Fonts oder anderen externen
          Font-Diensten) und laden keine externen Ressourcen nach.
        </p>
      </LegalSection>

      <LegalSection heading="6. Ihre Rechte">
        <p>Nach der DSGVO haben Sie insbesondere folgende Rechte:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Auskunft über die zu Ihrer Person gespeicherten Daten (Art. 15 DSGVO),</li>
          <li>Berichtigung unrichtiger Daten (Art. 16 DSGVO),</li>
          <li>Löschung Ihrer Daten (Art. 17 DSGVO) sowie</li>
          <li>Datenübertragbarkeit (Art. 20 DSGVO).</li>
        </ul>
        <p>
          Löschung und Datenübertragbarkeit stehen Ihnen direkt in der App zur
          Selbstbedienung offen: Unter <em>Einstellungen</em> können Sie Ihr Konto
          eigenständig und vollständig löschen sowie Ihre Daten als JSON oder CSV
          exportieren. Für alle anderen Anliegen wenden Sie sich an{" "}
          <EmailImage
            value={config.legal_email}
            placeholder="[E-MAIL-ADRESSE]"
            label="E-Mail-Adresse (als Bild angezeigt zum Schutz vor Spam)"
          />
          .
        </p>
        <p>
          Sie haben außerdem das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu
          beschweren (Art. 77 DSGVO), z. B. bei der für Ihren Wohnsitz zuständigen
          Landesdatenschutzbehörde.
        </p>
      </LegalSection>

      <LegalSection heading="7. Speicherdauer">
        <p>
          Wir speichern Ihre Daten, solange Ihr Konto besteht. Löschen Sie Ihr Konto (siehe
          oben), werden Ihr Profil, alle Portfolios, Assets, Transaktionen und geteilten
          Links unwiderruflich und vollständig entfernt. Die Löschung kaskadiert
          datenbankseitig über alle zugehörigen Tabellen.
        </p>
      </LegalSection>
    </LegalPage>
  );
}

function DatenschutzEN({ config }: { config: ReturnType<typeof useSiteConfig> }) {
  return (
    <LegalPage title="Privacy Policy" updated="Last updated: 4 July 2026">
      <LegalSection heading="1. Controller">
        <p>
          The controller within the meaning of the GDPR is the operator named in the{" "}
          <LegalLink href="/impressum">Imprint</LegalLink>:
        </p>
        <p>
          <LegalValue value={config.legal_name} placeholder="[FIRST AND LAST NAME]" />
          <br />
          <LegalValue value={config.legal_street} placeholder="[STREET AND HOUSE NUMBER]" />
          <br />
          <LegalValue value={config.legal_city} placeholder="[POSTAL CODE AND CITY]" />
          <br />
          Email:{" "}
          <EmailImage
            value={config.legal_email}
            placeholder="[EMAIL ADDRESS]"
            label="Email address (shown as an image to prevent spam)"
          />
        </p>
      </LegalSection>

      <LegalSection heading="2. Guest Mode: data never leaves your browser">
        <p>
          FinTrack can be used without registration in &ldquo;Guest Mode&rdquo;. In this
          mode your portfolio data (holdings, transactions, settings) never leaves your
          browser. It is stored exclusively in your device&rsquo;s{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800">
            localStorage
          </code>
          . We have no access to it and nothing is transmitted to a server. Clearing your
          browser storage deletes it irrecoverably.
        </p>
      </LegalSection>

      <LegalSection heading="3. Registered Mode: hosting, database and account">
        <p>
          In Registered Mode we process your portfolio data and account credentials via{" "}
          <strong>Supabase</strong> (authentication and a PostgreSQL database). The legal
          basis is Art. 6(1)(b) GDPR (performance of the usage contract you enter into by
          registering).
        </p>
        <p>
          For sign-in we set technically necessary Supabase auth cookies that manage your
          session. These cookies are strictly required to operate your account and are not
          subject to consent (§ 25(2) no. 2 TTDSG/DDG, Art. 6(1)(b) GDPR).
        </p>
        <p>
          You may sign in with email/password or via <strong>Google</strong> or{" "}
          <strong>GitHub</strong> (OAuth). During OAuth sign-in you are redirected to the
          respective provider&rsquo;s site and authenticate there. What data is processed
          during that step is governed by that provider&rsquo;s own privacy policy (Google
          or GitHub), not this one. We only receive the basic data needed to create your
          account (e.g. your email address).
        </p>
      </LegalSection>

      <LegalSection heading="4. Market data: quotes and exchange rates">
        <p>
          FinTrack displays quotes, price history, and exchange rates. This data is fetched
          by our server, <strong>not by your browser</strong>, from Yahoo Finance, Stooq,
          CoinGecko, and Frankfurter (ECB exchange rates).
        </p>
        <p>
          Concretely: your browser sends a request to our own server (e.g. &ldquo;fetch the
          current price for this ISIN/symbol&rdquo;); only our server then contacts these
          third-party providers. <strong>Your IP address is never disclosed to these
          providers</strong>. They only see our server&rsquo;s IP address. Only instrument
          identifiers (ISIN, symbol, or crypto id) and, where relevant, a target currency
          are sent. No data that identifies you personally is transmitted. The legal basis is Art. 6(1)(f)
          GDPR (legitimate interest in providing the app&rsquo;s core function).
        </p>
      </LegalSection>

      <LegalSection heading="5. Storage, cookies and local storage">
        <p>
          We use only technically necessary cookies and local storage,{" "}
          <strong>no third-party analytics, marketing, or tracking cookies</strong>:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Supabase auth cookies (Registered Mode, session management).</li>
          <li>
            <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800">
              localStorage
            </code>{" "}
            for: portfolio data in Guest Mode, your chosen language, your display
            preference (show/hide figures), your custom tags, and a cache of the
            instrument catalog (faster loading, no personal data).
          </li>
        </ul>
        <p>
          We do not embed any third-party analytics or tracking services. Fonts are
          self-hosted (no Google Fonts or other external font services are loaded), and no
          other external resources are fetched.
        </p>
      </LegalSection>

      <LegalSection heading="6. Your rights">
        <p>Under the GDPR you have, in particular, the following rights:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>access to the data stored about you (Art. 15 GDPR),</li>
          <li>rectification of inaccurate data (Art. 16 GDPR),</li>
          <li>erasure of your data (Art. 17 GDPR), and</li>
          <li>data portability (Art. 20 GDPR).</li>
        </ul>
        <p>
          Erasure and portability are available to you directly in the app, self-service:
          under <em>Settings</em> you can permanently delete your own account, and export
          your data as JSON or CSV. For any other request, contact{" "}
          <EmailImage
            value={config.legal_email}
            placeholder="[EMAIL ADDRESS]"
            label="Email address (shown as an image to prevent spam)"
          />
          .
        </p>
        <p>
          You also have the right to lodge a complaint with a supervisory authority (Art. 77
          GDPR), e.g. the data protection authority responsible for your place of residence.
        </p>
      </LegalSection>

      <LegalSection heading="7. Retention">
        <p>
          We keep your data for as long as your account exists. Deleting your account (see
          above) permanently and completely removes your profile, all portfolios, assets,
          transactions, and share links. The deletion cascades at the database level
          across all related tables.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
