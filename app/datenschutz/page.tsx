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
  const { config, loaded } = useSiteConfig();
  return locale === "de" ? (
    <DatenschutzDE config={config} loaded={loaded} />
  ) : (
    <DatenschutzEN config={config} loaded={loaded} />
  );
}

function DatenschutzDE({
  config,
  loaded,
}: {
  config: ReturnType<typeof useSiteConfig>["config"];
  loaded: boolean;
}) {
  return (
    <LegalPage title="Datenschutzerklärung" updated="Stand: 11. Juli 2026">
      <LegalSection heading="1. Verantwortlicher">
        <p>
          Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) ist der im{" "}
          <LegalLink href="/impressum">Impressum</LegalLink> genannte Betreiber:
        </p>
        <p>
          <LegalValue value={config.legal_name} loaded={loaded} placeholder="[VOR- UND NACHNAME]" />
          <br />
          <LegalValue value={config.legal_street} loaded={loaded} placeholder="[STRASSE UND HAUSNUMMER]" />
          <br />
          <LegalValue value={config.legal_city} loaded={loaded} placeholder="[PLZ UND ORT]" />
          <br />
          E-Mail:{" "}
          <EmailImage
            value={config.legal_email}
            loaded={loaded}
            placeholder="[E-MAIL-ADRESSE]"
            label="E-Mail-Adresse (als Bild angezeigt zum Schutz vor Spam)"
          />
        </p>
      </LegalSection>

      <LegalSection heading="2. Gastmodus: Daten bleiben im Browser">
        <p>
          FinTrack kann ohne Registrierung im „Gastmodus“ genutzt werden. In diesem Modus
          verlassen deine Portfoliodaten (Positionen, Transaktionen, Einstellungen) deinen
          Browser zu keinem Zeitpunkt. Sie werden ausschließlich im{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800">
            localStorage
          </code>{" "}
          deines Geräts gespeichert. Wir haben keinen Zugriff darauf, und es wird nichts an
          einen Server übertragen. Löschst du den Browserspeicher, sind die Daten
          unwiderruflich weg.
        </p>
      </LegalSection>

      <LegalSection heading="3. Registrierter Modus: Hosting, Datenbank und Konto">
        <p>
          Im registrierten Modus verarbeiten wir deine Portfoliodaten sowie deine
          Konto-Anmeldedaten über <strong>Supabase</strong> (Authentifizierung und
          PostgreSQL-Datenbank). Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Erfüllung
          des Nutzungsvertrags, den du durch die Registrierung mit uns eingehst).
        </p>
        <p>
          Zur Anmeldung setzen wir technisch notwendige Auth-Cookies von Supabase, die deine
          Sitzung verwalten. Diese Cookies sind für den Betrieb des Kontos zwingend
          erforderlich und unterliegen keinem Einwilligungsvorbehalt (§ 25 Abs. 2 Nr. 2
          TTDSG/DDG, Art. 6 Abs. 1 lit. b DSGVO).
        </p>
        <p>
          Du kannst dich mit E-Mail/Passwort oder über die Anbieter <strong>Google</strong>{" "}
          bzw. <strong>GitHub</strong> (OAuth) anmelden. Bei der OAuth-Anmeldung wirst du
          auf die Seite des jeweiligen Anbieters weitergeleitet und meldest dich dort an.
          Welche Daten dabei verarbeitet werden, unterliegt der Datenschutzerklärung des
          jeweiligen Anbieters (Google bzw. GitHub), nicht dieser Erklärung. Wir erhalten
          von diesen Anbietern lediglich die zur Kontoerstellung nötigen Basisdaten (z. B.
          E-Mail-Adresse).
        </p>
      </LegalSection>

      <LegalSection heading="4. Marktdaten: Kurse und Wechselkurse">
        <p>
          FinTrack zeigt Kurse, Kursverläufe und Wechselkurse an. Diese Daten werden von
          unserem Server, <strong>nicht von deinem Browser</strong>, abgerufen: bei den
          Anbietern Yahoo Finance, Stooq, CoinGecko und Frankfurter (EZB-Wechselkurse).
        </p>
        <p>
          Das bedeutet konkret: Dein Browser sendet eine Anfrage an unseren eigenen Server
          (z. B. „aktuellen Kurs für dieses ISIN/Symbol abrufen“); erst unser Server
          kontaktiert die genannten Drittanbieter. <strong>Deine IP-Adresse wird diesen
          Anbietern dabei nicht offengelegt</strong>. Sie sehen nur die IP-Adresse unseres
          Servers. Übermittelt werden ausschließlich Instrumentenkennungen (ISIN, Symbol
          bzw. Kryptowährungs-ID) und ggf. die Zielwährung, keine auf dich persönlich
          beziehbaren Daten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes
          Interesse an der Bereitstellung der Kernfunktion der App).
        </p>
      </LegalSection>

      <LegalSection heading="5. Fehlerprotokolle">
        <p>
          Wenn in der App ein technischer Fehler auftritt, speichern wir auf unserem eigenen
          Server ausschließlich technische Angaben zum Fehler (Fehlermeldung, technischer
          Stacktrace, die betroffene Seite und die Art deines Browsers). Es werden dabei keine
          personenbezogenen Daten, keine IP-Adresse und keine Inhalte deines Depots
          gespeichert. Diese Protokolle helfen uns nur, Fehler zu finden und zu beheben, und
          werden spätestens nach 30 Tagen automatisch gelöscht.
        </p>
      </LegalSection>

      <LegalSection heading="6. Speicherung, Cookies und lokaler Speicher">
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
            (Beträge ein-/ausblenden), deine eigenen Tags sowie einen Zwischenspeicher des
            Instrumenten-Katalogs (schnelleres Laden, keine personenbezogenen Daten). Auch
            historische Kursverläufe werden lokal zwischengespeichert, damit Diagramme
            schneller laden; dieser Zwischenspeicher wird bei der Abmeldung gelöscht. Die auf
            den rechtlichen Seiten (Impressum, Datenschutzerklärung) angezeigten öffentlichen
            Kontaktdaten des Betreibers werden ebenfalls lokal zwischengespeichert, damit sie
            sofort sichtbar sind.
          </li>
        </ul>
        <p>
          Wir binden keine Analyse- oder Tracking-Dienste Dritter ein. Schriftarten werden
          selbst gehostet (kein Nachladen von Google Fonts oder anderen externen
          Font-Diensten) und laden keine externen Ressourcen nach.
        </p>
      </LegalSection>

      <LegalSection heading="7. Deine Rechte">
        <p>Nach der DSGVO hast du insbesondere folgende Rechte:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Auskunft über die zu deiner Person gespeicherten Daten (Art. 15 DSGVO),</li>
          <li>Berichtigung unrichtiger Daten (Art. 16 DSGVO),</li>
          <li>Löschung deiner Daten (Art. 17 DSGVO) sowie</li>
          <li>Datenübertragbarkeit (Art. 20 DSGVO).</li>
        </ul>
        <p>
          Löschung und Datenübertragbarkeit stehen dir direkt in der App zur
          Selbstbedienung offen: Unter <em>Einstellungen</em> kannst du dein Konto
          eigenständig und vollständig löschen sowie deine Daten als JSON oder CSV
          exportieren. Für alle anderen Anliegen wende dich an{" "}
          <EmailImage
            value={config.legal_email}
            loaded={loaded}
            placeholder="[E-MAIL-ADRESSE]"
            label="E-Mail-Adresse (als Bild angezeigt zum Schutz vor Spam)"
          />
          .
        </p>
        <p>
          Du hast außerdem das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu
          beschweren (Art. 77 DSGVO), z. B. bei der für deinen Wohnsitz zuständigen
          Landesdatenschutzbehörde.
        </p>
      </LegalSection>

      <LegalSection heading="8. Speicherdauer">
        <p>
          Wir speichern deine Daten, solange dein Konto besteht. Löschst du dein Konto (siehe
          oben), werden dein Profil, alle Portfolios, Assets, Transaktionen und geteilten
          Links unwiderruflich und vollständig entfernt. Die Löschung kaskadiert
          datenbankseitig über alle zugehörigen Tabellen.
        </p>
      </LegalSection>
    </LegalPage>
  );
}

function DatenschutzEN({
  config,
  loaded,
}: {
  config: ReturnType<typeof useSiteConfig>["config"];
  loaded: boolean;
}) {
  return (
    <LegalPage title="Privacy Policy" updated="Last updated: 11 July 2026">
      <LegalSection heading="1. Controller">
        <p>
          The controller within the meaning of the GDPR is the operator named in the{" "}
          <LegalLink href="/impressum">Imprint</LegalLink>:
        </p>
        <p>
          <LegalValue value={config.legal_name} loaded={loaded} placeholder="[FIRST AND LAST NAME]" />
          <br />
          <LegalValue value={config.legal_street} loaded={loaded} placeholder="[STREET AND HOUSE NUMBER]" />
          <br />
          <LegalValue value={config.legal_city} loaded={loaded} placeholder="[POSTAL CODE AND CITY]" />
          <br />
          Email:{" "}
          <EmailImage
            value={config.legal_email}
            loaded={loaded}
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

      <LegalSection heading="5. Error logs">
        <p>
          When a technical error occurs in the app, we store on our own server only technical
          details about the error (the error message, the technical stack trace, the affected
          page, and your browser type). No personal data, no IP address, and no content from
          your portfolio is stored. These logs only help us find and fix bugs and are
          automatically deleted after 30 days at the latest.
        </p>
      </LegalSection>

      <LegalSection heading="6. Storage, cookies and local storage">
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
            instrument catalog (faster loading, no personal data). Historical price
            series are also cached locally to speed up chart loading; this cache is
            deleted when you sign out. The public operator contact data shown on the
            legal pages (Imprint, Privacy Policy) is also cached locally so it
            displays immediately.
          </li>
        </ul>
        <p>
          We do not embed any third-party analytics or tracking services. Fonts are
          self-hosted (no Google Fonts or other external font services are loaded), and no
          other external resources are fetched.
        </p>
      </LegalSection>

      <LegalSection heading="7. Your rights">
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
            loaded={loaded}
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

      <LegalSection heading="8. Retention">
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
