"use client";

import { useI18n } from "@/lib/i18n/i18n-context";
import { LegalPage, LegalSection, LegalLink } from "@/components/legal/legal-page";

export default function TermsPage() {
  const { locale } = useI18n();
  return locale === "de" ? <TermsDE /> : <TermsEN />;
}

function TermsDE() {
  return (
    <LegalPage title="Nutzungsbedingungen" updated="Stand: 19. Juli 2026">
      <LegalSection heading="1. Leistungsbeschreibung">
        <p>
          FinTrack ist ein Werkzeug zur Verfolgung und Analyse des eigenen Vermögensportfolios
          (Wertentwicklung, Kennzahlen, Simulationen, Allokation). Die App kann ohne
          Registrierung im Gastmodus (Daten nur im Browser) oder registriert mit
          server-seitiger Speicherung genutzt werden.
        </p>
      </LegalSection>

      <LegalSection heading="2. Keine Anlageberatung">
        <p>
          FinTrack ist ein reines Informations- und Verwaltungswerkzeug.{" "}
          <strong>
            Nichts in dieser App stellt eine Anlage-, Steuer- oder Rechtsberatung dar
          </strong>{" "}
          und ist nicht als Empfehlung zum Kauf oder Verkauf von Finanzinstrumenten zu
          verstehen. Simulationen (z. B. die Monte-Carlo-Projektion) sind mathematische
          Modelle auf Basis historischer bzw. angenommener Kennzahlen und keine Prognose
          künftiger Ergebnisse. Triff Anlageentscheidungen eigenverantwortlich oder
          ziehe einen unabhängigen Berater hinzu.
        </p>
      </LegalSection>

      <LegalSection heading="3. Keine Gewähr für Datenrichtigkeit">
        <p>
          Kurse, Kursverläufe, Wechselkurse und daraus abgeleitete Kennzahlen stammen aus
          Drittquellen (u. a. Yahoo Finance, Stooq, CoinGecko, Frankfurter/EZB) oder werden,
          wo keine reale Quelle verfügbar ist, durch einen deterministischen synthetischen
          Kursverlauf angenähert. Diese Daten können verzögert, unvollständig, fehlerhaft
          oder geschätzt sein. Wir übernehmen keine Gewähr für die Richtigkeit,
          Vollständigkeit oder Aktualität der angezeigten Daten.
        </p>
      </LegalSection>

      <LegalSection heading="4. Verfügbarkeit">
        <p>
          Wir bemühen uns um einen zuverlässigen Betrieb der App, garantieren jedoch keine
          bestimmte Verfügbarkeit, Fehlerfreiheit oder unterbrechungsfreie Erreichbarkeit.
          Wartungsarbeiten, Ausfälle von Drittanbietern oder höhere Gewalt können den Zugang
          zeitweise einschränken.
        </p>
      </LegalSection>

      <LegalSection heading="5. Pflichten der Nutzer">
        <p>
          Du bist verantwortlich für die Vertraulichkeit deiner Zugangsdaten und für alle
          Aktivitäten unter deinem Konto. Du verpflichtest dich, die App nicht missbräuchlich
          oder rechtswidrig zu nutzen und nur Daten einzugeben, zu deren Verarbeitung du
          berechtigt bist.
        </p>
      </LegalSection>

      <LegalSection heading="6. Kündigung und Löschung">
        <p>
          Du kannst die Nutzung jederzeit beenden und dein Konto samt aller Daten
          eigenständig unter <em>Einstellungen</em> löschen. Wir behalten uns vor, Konten
          bei missbräuchlicher Nutzung oder Verstoß gegen diese Bedingungen zu sperren oder
          zu löschen.
        </p>
      </LegalSection>

      <LegalSection heading="7. Bezahltes Pro-Abo">
        <p>
          Neben dem kostenlosen Funktionsumfang bieten wir optional ein kostenpflichtiges
          <strong> Pro-Abo</strong> an, monatlich oder jährlich abrechenbar. Das Abo
          verlängert sich automatisch um die jeweils gewählte Laufzeit, sofern du es nicht
          vorher kündigst. Maßgeblich sind die Preise, die dir beim Checkout angezeigt
          werden. Du kannst dein Abo jederzeit selbst über das Kundenportal (erreichbar unter{" "}
          <em>Einstellungen</em>) kündigen; die Kündigung wird zum Ende der laufenden
          Abrechnungsperiode wirksam, dein Zugang zu den Pro-Funktionen bleibt bis dahin
          bestehen.
        </p>
        <p>
          Als Verbraucher innerhalb der EU steht dir grundsätzlich ein 14-tägiges
          Widerrufsrecht zu. Da es sich beim Pro-Abo um eine digitale Dienstleistung handelt,
          die sofort mit Vertragsschluss beginnt, erlischt dieses Widerrufsrecht vorzeitig,
          wenn du beim Checkout ausdrücklich zustimmst, dass die Ausführung vor Ablauf der
          Widerrufsfrist beginnt, und gleichzeitig bestätigst, dass du dadurch dein
          Widerrufsrecht verlierst.
        </p>
      </LegalSection>

      <LegalSection heading="8. Anwendbares Recht">
        <p>
          Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts,
          soweit zwingende verbraucherschützende Vorschriften deines gewöhnlichen
          Aufenthaltsorts dem nicht entgegenstehen.
        </p>
      </LegalSection>

      <LegalSection heading="9. Kontakt">
        <p>
          Fragen zu diesen Bedingungen richtest du an die im{" "}
          <LegalLink href="/impressum">Impressum</LegalLink> genannten Kontaktdaten.
        </p>
      </LegalSection>
    </LegalPage>
  );
}

function TermsEN() {
  return (
    <LegalPage title="Terms of Service" updated="Last updated: 19 July 2026">
      <LegalSection heading="1. Service description">
        <p>
          FinTrack is a tool for tracking and analysing your own investment portfolio
          (performance, metrics, simulations, allocation). It can be used without
          registration in Guest Mode (data stays in your browser) or registered, with
          server-side storage.
        </p>
      </LegalSection>

      <LegalSection heading="2. Not investment advice">
        <p>
          FinTrack is purely an information and record-keeping tool.{" "}
          <strong>
            Nothing in this app constitutes investment, tax, or legal advice
          </strong>{" "}
          and nothing should be understood as a recommendation to buy or sell any financial
          instrument. Simulations (e.g. the Monte Carlo projection) are mathematical models
          based on historical or assumed inputs, not a forecast of future results. Make
          investment decisions at your own responsibility, or consult an independent
          advisor.
        </p>
      </LegalSection>

      <LegalSection heading="3. No guarantee of data accuracy">
        <p>
          Prices, price history, exchange rates, and metrics derived from them come from
          third-party sources (including Yahoo Finance, Stooq, CoinGecko, and
          Frankfurter/ECB) or, where no real source is available, are approximated with a
          deterministic synthetic price series. This data may be delayed, incomplete,
          inaccurate, or estimated. We make no warranty as to the accuracy, completeness, or
          timeliness of the data displayed.
        </p>
      </LegalSection>

      <LegalSection heading="4. Availability">
        <p>
          We aim to run the app reliably but do not guarantee any particular availability,
          error-free operation, or uninterrupted access. Maintenance, third-party provider
          outages, or events beyond our control may temporarily limit access.
        </p>
      </LegalSection>

      <LegalSection heading="5. User responsibilities">
        <p>
          You are responsible for keeping your credentials confidential and for all
          activity under your account. You agree not to misuse the app or use it unlawfully,
          and to only enter data you are entitled to process.
        </p>
      </LegalSection>

      <LegalSection heading="6. Termination and deletion">
        <p>
          You may stop using the service at any time and delete your account, together
          with all of its data, yourself under <em>Settings</em>. We reserve the right to
          suspend or delete accounts in cases of abusive use or breach of these terms.
        </p>
      </LegalSection>

      <LegalSection heading="7. Paid Pro subscription">
        <p>
          Alongside the free feature set, we optionally offer a paid <strong>Pro
          subscription</strong>, billed monthly or yearly. The subscription automatically
          renews for the same term unless you cancel it beforehand. The prices shown to you
          at checkout apply. You can cancel your subscription yourself at any time via the
          billing portal (reachable from <em>Settings</em>); cancellation takes effect at
          the end of the current billing period, and your access to Pro features continues
          until then.
        </p>
        <p>
          As an EU consumer you generally have a 14-day right of withdrawal. Because the Pro
          subscription is a digital service that begins immediately upon purchase, this
          right expires early if you expressly consent at checkout to performance starting
          before the withdrawal period ends and confirm that you thereby lose your right of
          withdrawal.
        </p>
      </LegalSection>

      <LegalSection heading="8. Governing law">
        <p>
          These terms are governed by the law of the Federal Republic of Germany, excluding
          the UN Convention on Contracts for the International Sale of Goods, to the extent
          mandatory consumer-protection provisions of your habitual residence do not
          provide otherwise.
        </p>
      </LegalSection>

      <LegalSection heading="9. Contact">
        <p>
          Questions about these terms can be directed to the contact details listed in the{" "}
          <LegalLink href="/impressum">Imprint</LegalLink>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
