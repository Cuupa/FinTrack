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
    <LegalPage title="Datenschutzerklärung" updated="Stand: 17. Juli 2026">
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
            für: Portfoliodaten im Gastmodus (einschließlich deiner eigenen Tags), die gewählte
            Sprache, den Anzeige-Modus (Beträge ein-/ausblenden) sowie einen Zwischenspeicher des
            Instrumenten-Katalogs (schnelleres Laden, keine personenbezogenen Daten). Im
            registrierten Modus werden deine Tags, wie alle anderen Portfoliodaten, in der
            Datenbank gespeichert (siehe Abschnitt 3). Auch
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

      <LegalSection heading="9. KI-Assistent (optional, eigener API-Schlüssel)">
        <p>
          FinTrack bietet optional einen KI-Assistenten an, mit dem du in natürlicher Sprache
          Fragen zu deinem Portfolio stellen kannst. Diese Funktion ist <strong>opt-in</strong>{" "}
          und standardmäßig deaktiviert: Sie funktioniert nur, wenn du in den Einstellungen
          einen eigenen API-Schlüssel eines Anbieters deiner Wahl hinterlegst
          („Bring your own key“).
        </p>
        <p>
          Im Gastmodus wird dein API-Schlüssel ausschließlich lokal in deinem Browser gespeichert
          (
          <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800">
            localStorage
          </code>
          ). Bist du registriert und angemeldet, kannst du in den Einstellungen wählen, wo dein
          Schlüssel gespeichert wird: entweder in deinem Konto in unserer Datenbank, geschützt durch
          nutzerspezifische Zugriffskontrollen (Row-Level Security), sodass er auf all deinen Geräten
          verfügbar ist, oder ausschließlich lokal in diesem Browser. Eine Verschlüsselung im
          Ruhezustand (encryption at rest) über die Standard-Datenbankverschlüsselung unseres Hosters
          hinaus bieten wir nicht an. Einen Schlüssel in diesem Browser entfernst du, indem du ihn in
          den Einstellungen löschst oder deine Browserdaten leerst; er wird außerdem automatisch beim
          Abmelden gelöscht, da er bewusst an diesen Browser gebunden ist. Ein Schlüssel in deinem
          Konto bleibt gespeichert, bis du ihn in den Einstellungen entfernst oder auf Browserspeicher
          umstellst; er wird nicht automatisch beim Abmelden gelöscht, da er zu deinem Konto gehört
          wie alle anderen Portfoliodaten. Ein Wechsel des Speicherorts in den Einstellungen
          verschiebt den Schlüssel sofort vom einen zum anderen Ort.
        </p>
        <p>
          Nutzt du den Chat, werden deine Portfoliodaten (Positionen, Sparpläne, Risikokennzahlen)
          zusammen mit deiner Nachricht an den von dir gewählten Anbieter übertragen, damit
          dieser eine Antwort erzeugen kann. Diese Übertragung erfolgt über unseren Server als
          reinen Durchleiter (Proxy): Wir speichern und protokollieren die übertragenen Inhalte
          nicht. Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), die du
          durch das aktive Hinterlegen eines eigenen Schlüssels erteilst.
        </p>
        <p>
          Welche Daten der jeweilige Anbieter mit deiner Anfrage verarbeitet und wie lange er sie
          speichert, unterliegt dessen eigener Datenschutzerklärung, nicht dieser Erklärung:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <LegalLink href="https://www.anthropic.com/legal/privacy">
              Datenschutzerklärung von Anthropic (Claude)
            </LegalLink>
          </li>
          <li>
            <LegalLink href="https://openai.com/policies/privacy-policy">
              Datenschutzerklärung von OpenAI (GPT)
            </LegalLink>
          </li>
          <li>
            <LegalLink href="https://policies.google.com/privacy">
              Datenschutzerklärung von Google (Gemini)
            </LegalLink>
          </li>
        </ul>
        <p>
          Der Assistent gibt Modellwerte aus und ersetzt keine Anlageberatung. Du kannst deinen
          gespeicherten Schlüssel jederzeit in den Einstellungen entfernen.
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
    <LegalPage title="Privacy Policy" updated="Last updated: 17 July 2026">
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
            for: portfolio data in Guest Mode (including your custom tags), your chosen
            language, your display preference (show/hide figures), and a cache of the
            instrument catalog (faster loading, no personal data). Historical price
            series are also cached locally to speed up chart loading; this cache is
            deleted when you sign out. The public operator contact data shown on the
            legal pages (Imprint, Privacy Policy) is also cached locally so it
            displays immediately. In Registered Mode your tags, like the rest of your
            portfolio data, are stored in the database instead (see section 3).
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

      <LegalSection heading="9. AI assistant (optional, your own API key)">
        <p>
          FinTrack optionally offers an AI assistant that lets you ask questions about your
          portfolio in natural language. This feature is <strong>opt-in</strong> and disabled by
          default: it only works once you add your own API key for a provider of your choice in
          Settings (&ldquo;bring your own key&rdquo;).
        </p>
        <p>
          In Guest Mode, your API key is stored exclusively in your browser (
          <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800">
            localStorage
          </code>
          ). If you are registered and signed in, you can choose in Settings where the key is
          stored: either in your account in our database, protected by per-user access controls
          (row-level security), so it is available on every device you use, or exclusively in this
          browser. We do not offer encryption at rest beyond our hosting provider&rsquo;s standard
          database encryption. A key stored in this browser is removed by deleting it in Settings or
          clearing your browser data, and it is also automatically removed on sign-out, since it is
          deliberately scoped to this browser. A key stored in your account stays stored until you
          remove it in Settings or switch it to browser storage; it is not automatically deleted on
          sign-out since it belongs to your account like every other piece of portfolio data.
          Switching the storage location in Settings moves the key immediately from one place to
          the other.
        </p>
        <p>
          When you use the chat, your portfolio data (holdings, savings plans, risk figures) is
          sent together with your message to the provider you chose, so it can generate a reply.
          This transmission goes through our server acting purely as a relay (proxy): we do not
          store or log the transmitted content. The legal basis is your consent (Art. 6(1)(a)
          GDPR), given by actively adding your own key.
        </p>
        <p>
          What data the respective provider processes with your request and how long it retains
          it is governed by that provider&rsquo;s own privacy policy, not this one:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <LegalLink href="https://www.anthropic.com/legal/privacy">
              Anthropic (Claude) privacy policy
            </LegalLink>
          </li>
          <li>
            <LegalLink href="https://openai.com/policies/privacy-policy">
              OpenAI (GPT) privacy policy
            </LegalLink>
          </li>
          <li>
            <LegalLink href="https://policies.google.com/privacy">
              Google (Gemini) privacy policy
            </LegalLink>
          </li>
        </ul>
        <p>
          The assistant produces modeled output and is not investment advice. You can remove your
          stored key in Settings at any time.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
