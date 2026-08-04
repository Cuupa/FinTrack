"use client";

// Retirement provision (flag `pension`): the statutory entitlement in
// Entgeltpunkte plus the private/company policies that pay on top of it.
//
// The projection itself is pure (`lib/finance/pension.ts`) and the Rentenwert
// it values points with is reference data read from the DB
// (`usePensionReference`), never a constant here. Everything the user owns
// rides the store seam via usePortfolio(); no mode branching.
//
// Everything is in TODAY's money on purpose -- see the header comment of
// lib/finance/pension.ts. The page says so out loud rather than letting a
// figure look more precise than it is.

import { useCallback, useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import {
  allStatements,
  contractReturn,
  looksLikeStatements,
  pensionLevelOn,
  projectContract,
  projectPension,
  resolveContract,
  standardRetirementAge,
  statementAnnualPoints,
  type PensionProjection,
} from "@/lib/finance/pension";
import { today } from "@/lib/finance/dates";
import { pendingPremiums } from "@/lib/finance/pension-bookings";
import { usePensionReference } from "@/lib/pension/use-pension-reference";
import {
  PENSION_CONTRACT_KINDS,
  type PensionContract,
  type PensionContractKind,
  type PensionContractValue,
  type PensionPoint,
  type PensionStatement,
} from "@/lib/types";
import type { PensionContractInput } from "@/lib/store/types";
import { formatCurrency, formatDate, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card, Stat, Toggle } from "@/components/ui/primitives";
import { Private } from "@/components/ui/private";
import { FormActions } from "@/components/ui/form-actions";
import { SelectMenu } from "@/components/ui/select-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TablePagination,
  usePagination,
} from "@/components/ui/table";
import { useSort } from "@/components/ui/use-sort";
import { DeleteAction, EditAction, HistoryAction, RowActions } from "@/components/ui/row-actions";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError, storeErrorReason } from "@/lib/store/errors";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

/** Parses a user-typed number, treating blank as "not stated" (null) rather
 *  than 0 — the projection distinguishes the two everywhere. */
function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = parseDecimal(trimmed);
  return Number.isFinite(n) ? n : null;
}

function optionalText(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Assumptions

function AssumptionsCard({ projection }: { projection: PensionProjection }) {
  const { t } = useI18n();
  const { data, updateProfile } = usePortfolio();
  const settings = data.profile.pensionSettings;

  const [birthYear, setBirthYear] = useState(
    settings.birthYear != null ? String(settings.birthYear) : "",
  );
  const [retirementAge, setRetirementAge] = useState(
    settings.retirementAge != null ? String(settings.retirementAge) : "",
  );
  const [annualPoints, setAnnualPoints] = useState(
    settings.annualPoints != null ? String(settings.annualPoints) : "",
  );
  const [targetMonthly, setTargetMonthly] = useState(
    settings.targetMonthly != null ? String(settings.targetMonthly) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parsedBirthYear = optionalNumber(birthYear);
  const standardAge = parsedBirthYear != null ? standardRetirementAge(parsedBirthYear) : null;

  async function save() {
    setError(null);
    setSaved(false);
    try {
      await updateProfile({
        pensionSettings: {
          // Spread first: the statement total is edited in the points card and
          // must survive a save here, not be reset to null by omission.
          ...settings,
          birthYear: parsedBirthYear,
          retirementAge: optionalNumber(retirementAge),
          annualPoints: optionalNumber(annualPoints),
          targetMonthly: optionalNumber(targetMonthly),
        },
      });
      setSaved(true);
    } catch (err) {
      setError(
        isStorageFullError(err)
          ? t("common.storageFull")
          : `${t("pension.saveFailed")} ${storeErrorReason(err)}`.trim(),
      );
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold">{t("pension.assumptions.title")}</h2>
      <p className="mt-1 text-xs text-zinc-500">{t("pension.assumptions.hint")}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.birthYear")}</span>
          <input
            className={inputCls}
            inputMode="numeric"
            value={birthYear}
            onChange={(e) => setBirthYear(stripLeadingZero(e.target.value))}
            placeholder="1990"
          />
          {standardAge != null && (
            <span className="mt-1 block text-xs text-zinc-500">
              {t("pension.standardAge", { age: standardAge.toFixed(1) })}
            </span>
          )}
        </label>
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.retirementAge")}</span>
          <input
            className={inputCls}
            inputMode="decimal"
            value={retirementAge}
            onChange={(e) => setRetirementAge(stripLeadingZero(e.target.value))}
            placeholder={standardAge != null ? standardAge.toFixed(1) : "67"}
          />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.annualPoints")}</span>
          <input
            className={inputCls}
            inputMode="decimal"
            value={annualPoints}
            onChange={(e) => setAnnualPoints(stripLeadingZero(e.target.value))}
            placeholder={projection.annualPoints.toFixed(2)}
          />
          <span className="mt-1 block text-xs text-zinc-500">
            {projection.maxAnnualPoints != null
              ? t("pension.annualPointsHintMax", {
                  points: projection.annualPoints.toFixed(2),
                  max: projection.maxAnnualPoints.toFixed(2),
                })
              : t("pension.annualPointsHint", { points: projection.annualPoints.toFixed(2) })}
          </span>
        </label>
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.targetMonthly")}</span>
          <input
            className={inputCls}
            inputMode="decimal"
            value={targetMonthly}
            onChange={(e) => setTargetMonthly(stripLeadingZero(e.target.value))}
          />
        </label>
      </div>
      {/* Off by default: the default has to reproduce the Renteninformation,
          which assumes no career progression at all. Offered here because a
          rising record IS information, just not the official method. */}
      {projection.trendAvailable && (
        <div className="mt-4">
          <Toggle
            checked={settings.assumeTrend === true}
            onChange={(next) =>
              void updateProfile({
                pensionSettings: { ...settings, assumeTrend: next ? true : null },
              }).catch(() => {})
            }
            label={t("pension.assumeTrend")}
            hint={t("pension.assumeTrendHint", {
              years: String(projection.trendSampleSize),
            })}
          />
        </div>
      )}
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save}>{t("pension.save")}</Button>
        {saved && <span className="text-xs text-emerald-600">{t("pension.saved")}</span>}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Entgeltpunkte record

type PointSortKey = "year" | "points" | "note";

type StatementSortKey = "year" | "totalPoints" | "note";

/**
 * The Renteninformationen themselves, one row per letter.
 *
 * The letter states a cumulative TOTAL and no per-year figure at all, so this
 * is the only table most users can actually fill in. Two letters give the
 * accrual rate by subtraction, which is what "wenn Sie so weitermachen wie
 * bisher" means when the year-by-year record does not exist.
 */
function StatementsFields() {
  const { t } = useI18n();
  const { data, setPensionStatements, updateProfile } = usePortfolio();
  const settings = data.profile.pensionSettings;
  // The legacy single Gesamtstand is one more letter, listed and editable like
  // any other, so nobody's earlier entry disappears from the page.
  const rows = useMemo(
    () => allStatements(data.pensionStatements, settings),
    [data.pensionStatements, settings],
  );
  const rate = statementAnnualPoints(data.pensionStatements, settings);

  const [year, setYear] = useState("");
  const [total, setTotal] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PensionStatement | null>(null);

  const sort = useSort<StatementSortKey>("year", "desc");
  const sorted = useMemo(
    () => sort.apply(rows, (r, key) => (key === "note" ? (r.note ?? "") : r[key])),
    [rows, sort],
  );

  /** Writing the list always retires the legacy settings pair: it now lives in
   *  the list, and two homes for one figure is how it gets counted twice. */
  async function write(next: PensionStatement[], onOk: () => void) {
    setError(null);
    try {
      await setPensionStatements(next);
      if (settings.totalPoints != null || settings.totalPointsYear != null) {
        await updateProfile({
          pensionSettings: { ...settings, totalPoints: null, totalPointsYear: null },
        });
      }
      onOk();
    } catch (err) {
      setError(
        isStorageFullError(err)
          ? t("common.storageFull")
          : `${t("pension.saveFailed")} ${storeErrorReason(err)}`.trim(),
      );
    }
  }

  async function add() {
    const y = optionalNumber(year);
    const p = optionalNumber(total);
    if (y == null || p == null) {
      setError(t("pension.statements.invalid"));
      return;
    }
    const next = [
      ...rows.filter((s) => s.year !== y),
      { year: y, totalPoints: p, note: optionalText(note) },
    ];
    await write(next, () => {
      setYear("");
      setTotal("");
      setNote("");
    });
  }

  return (
    <div>
      <h3 className="text-sm font-medium">{t("pension.statements.title")}</h3>
      <p className="mt-1 text-xs text-zinc-500">{t("pension.statements.hint")}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.statements.year")}</span>
          <input
            className={inputCls}
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(stripLeadingZero(e.target.value))}
            placeholder={String(new Date().getFullYear())}
          />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.statements.total")}</span>
          <input
            className={inputCls}
            inputMode="decimal"
            value={total}
            onChange={(e) => setTotal(stripLeadingZero(e.target.value))}
            placeholder="13,2739"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-zinc-500">{t("pension.statements.note")}</span>
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <FormActions error={error}>
        <Button onClick={add} disabled={year.trim() === "" || total.trim() === ""}>
          {t("pension.statements.add")}
        </Button>
      </FormActions>

      {rows.length > 0 && (
        <div className="mt-4">
          <Table ariaLabel={t("pension.statements.title")}>
            <Thead>
              <Th sort={sort.sort} sortKey="year" onSort={sort.toggle}>
                {t("pension.statements.year")}
              </Th>
              <Th align="right" sort={sort.sort} sortKey="totalPoints" onSort={sort.toggle}>
                {t("pension.statements.total")}
              </Th>
              <Th sort={sort.sort} sortKey="note" onSort={sort.toggle}>
                {t("pension.statements.note")}
              </Th>
              <Th align="right" />
            </Thead>
            <Tbody>
              {sorted.map((row) => (
                <Tr key={row.year}>
                  <Td>{row.year}</Td>
                  <Td align="right">{row.totalPoints.toFixed(4)}</Td>
                  <Td className="text-zinc-500">{row.note ?? ""}</Td>
                  <Td align="right">
                    <RowActions>
                      <DeleteAction
                        label={t("common.delete")}
                        onClick={() => setPendingDelete(row)}
                      />
                    </RowActions>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}

      {/* The subtraction the whole projection rests on, spelled out. */}
      <p className="mt-3 text-xs text-zinc-500">
        {rate
          ? t("pension.statements.rate", {
              points: rate.points.toFixed(4),
              gained: rate.gainedPoints.toFixed(4),
              years: String(rate.toYear - rate.fromYear),
              from: String(rate.fromYear),
              to: String(rate.toYear),
            })
          : t("pension.statements.needSecond")}
      </p>

      {pendingDelete && (
        <ConfirmDialog
          open
          title={t("pension.statements.deleteTitle")}
          message={t("pension.statements.deleteMessage", { year: String(pendingDelete.year) })}
          confirmLabel={t("common.delete")}
          onConfirm={async () => {
            const y = pendingDelete.year;
            await write(
              rows.filter((s) => s.year !== y),
              () => setPendingDelete(null),
            );
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function PointsCard({ maxPoints }: { maxPoints: number | null }) {
  const { t } = useI18n();
  const { data, setPensionPoints, setPensionStatements } = usePortfolio();
  const entries = data.pensionPoints;

  // Several Renteninformationen typed into the year table: rising values, the
  // newest above what a year can earn. Offered as a one-click move rather than
  // done silently -- they are the user's rows.
  const mistyped = looksLikeStatements(entries, maxPoints);
  const [pendingMove, setPendingMove] = useState(false);

  async function moveToStatements() {
    const merged = [
      ...data.pensionStatements.filter((s) => !entries.some((e) => e.year === s.year)),
      ...entries.map((e) => ({ year: e.year, totalPoints: e.points, note: e.note })),
    ];
    await setPensionStatements(merged);
    await setPensionPoints([]);
    setPendingMove(false);
  }

  const [year, setYear] = useState("");
  const [points, setPoints] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PensionPoint | null>(null);

  // The moment the mistake is actually made: a cumulative total typed into a
  // single year. Say so here rather than letting the projection quietly cap it.
  const typedPoints = optionalNumber(points);
  const overMax = maxPoints != null && typedPoints != null && typedPoints > maxPoints;

  const sort = useSort<PointSortKey>("year", "desc");
  const rows = useMemo(
    () => sort.apply(entries, (r, key) => (key === "note" ? (r.note ?? "") : r[key])),
    [entries, sort],
  );
  const pager = usePagination(rows);

  async function write(next: PensionPoint[], onOk: () => void) {
    setError(null);
    try {
      await setPensionPoints(next);
      onOk();
    } catch (err) {
      setError(
        isStorageFullError(err)
          ? t("common.storageFull")
          : `${t("pension.saveFailed")} ${storeErrorReason(err)}`.trim(),
      );
    }
  }

  async function add() {
    const y = optionalNumber(year);
    const p = optionalNumber(points);
    if (y == null || p == null) {
      setError(t("pension.points.invalid"));
      return;
    }
    // Replace-set semantics: retyping a year overwrites it, never stacks.
    const next = [
      ...entries.filter((e) => e.year !== y),
      { year: y, points: p, note: optionalText(note) },
    ];
    await write(next, () => {
      setYear("");
      setPoints("");
      setNote("");
    });
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold">{t("pension.points.title")}</h2>

      <div className="mt-3">
        <StatementsFields />
      </div>

      <h3 className="mt-6 border-t border-zinc-100 pt-4 text-sm font-medium dark:border-zinc-800">
        {t("pension.points.detailTitle")}
      </h3>
      <p className="mt-1 text-xs text-zinc-500">{t("pension.points.hint")}</p>

      {mistyped && (
        <div className="mt-3 rounded-md border border-amber-300 p-3 dark:border-amber-500/40">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {t("pension.points.looksLikeStatements")}
          </p>
          <div className="mt-2">
            <Button onClick={() => setPendingMove(true)}>{t("pension.points.moveToStatements")}</Button>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.points.year")}</span>
          <input
            className={inputCls}
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(stripLeadingZero(e.target.value))}
          />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.points.points")}</span>
          <input
            className={inputCls}
            inputMode="decimal"
            value={points}
            onChange={(e) => setPoints(stripLeadingZero(e.target.value))}
          />
          {overMax && (
            <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
              {t("pension.points.overMax", { max: maxPoints!.toFixed(2) })}
            </span>
          )}
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-zinc-500">{t("pension.points.note")}</span>
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <FormActions error={error}>
        <Button onClick={add} disabled={year.trim() === "" || points.trim() === ""}>
          {t("pension.points.add")}
        </Button>
      </FormActions>

      {entries.length > 0 && (
        <div className="mt-4">
          <Table ariaLabel={t("pension.points.title")}>
            <Thead>
              <Th sort={sort.sort} sortKey="year" onSort={sort.toggle}>
                {t("pension.points.year")}
              </Th>
              <Th align="right" sort={sort.sort} sortKey="points" onSort={sort.toggle}>
                {t("pension.points.points")}
              </Th>
              <Th sort={sort.sort} sortKey="note" onSort={sort.toggle}>
                {t("pension.points.note")}
              </Th>
              <Th align="right" />
            </Thead>
            <Tbody>
              {pager.rows.map((row) => (
                <Tr key={row.year}>
                  <Td>{row.year}</Td>
                  <Td align="right">{row.points.toFixed(4)}</Td>
                  <Td className="text-zinc-500">{row.note ?? ""}</Td>
                  <Td align="right">
                    <RowActions>
                      <DeleteAction
                        label={t("common.delete")}
                        onClick={() => setPendingDelete(row)}
                      />
                    </RowActions>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <TablePagination pager={pager} />
        </div>
      )}

      {pendingMove && (
        <ConfirmDialog
          open
          title={t("pension.points.moveTitle")}
          message={t("pension.points.moveMessage", { count: String(entries.length) })}
          confirmLabel={t("pension.points.moveToStatements")}
          onConfirm={moveToStatements}
          onCancel={() => setPendingMove(false)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          open
          title={t("pension.points.deleteTitle")}
          message={t("pension.points.deleteMessage", { year: String(pendingDelete.year) })}
          confirmLabel={t("common.delete")}
          onConfirm={async () => {
            const year = pendingDelete.year;
            await write(
              entries.filter((e) => e.year !== year),
              () => setPendingDelete(null),
            );
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Private / company policies

function ContractForm({
  initial,
  onSubmit,
  submitLabel,
}: {
  initial?: PensionContract;
  onSubmit: (input: PensionContractInput) => Promise<void>;
  submitLabel: string;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<PensionContractKind>(initial?.kind ?? "private");
  const [provider, setProvider] = useState(initial?.provider ?? "");
  const [contribution, setContribution] = useState(
    initial?.monthlyContribution != null ? String(initial.monthlyContribution) : "",
  );
  const [value, setValue] = useState(
    initial?.currentValue != null ? String(initial.currentValue) : "",
  );
  const [expected, setExpected] = useState(
    initial?.expectedMonthlyPension != null ? String(initial.expectedMonthlyPension) : "",
  );
  const [rentenfaktor, setRentenfaktor] = useState(
    initial?.rentenfaktor != null ? String(initial.rentenfaktor) : "",
  );
  const [dynamicPct, setDynamicPct] = useState(
    initial?.contributionDynamicPct != null ? String(initial.contributionDynamicPct) : "",
  );
  const [returnPct, setReturnPct] = useState(
    initial?.expectedReturnPct != null ? String(initial.expectedReturnPct) : "",
  );
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? "");
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [bookingStartDate, setBookingStartDate] = useState(initial?.bookingStartDate ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  // The payout follows from the capital as soon as the policy's Rentenfaktor
  // is known, so the preview recomputes with every keystroke — the same pure
  // function the projection runs on, never a second formula.
  const { data } = usePortfolio();
  const base = data.profile.currency;
  const accounts = data.accounts;
  const settings = data.profile.pensionSettings;
  const currentYear = Number(today().slice(0, 4));
  const fallbackRetirementYear =
    settings.birthYear != null
      ? Math.round(
          settings.birthYear + (settings.retirementAge ?? standardRetirementAge(settings.birthYear)),
        )
      : null;
  const preview = projectContract(
    {
      id: initial?.id ?? "preview",
      name,
      kind,
      provider: null,
      monthlyContribution: optionalNumber(contribution),
      currentValue: optionalNumber(value),
      expectedMonthlyPension: optionalNumber(expected),
      rentenfaktor: optionalNumber(rentenfaktor),
      contributionDynamicPct: optionalNumber(dynamicPct),
      expectedReturnPct: optionalNumber(returnPct),
      startsOn: optionalText(startsOn),
      accountId: null,
      bookingStartDate: null,
      lastBookedDate: null,
      note: null,
    },
    currentYear,
    fallbackRetirementYear,
  );
  const derivesPayout = preview.derived;

  async function submit() {
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        kind,
        provider: optionalText(provider),
        monthlyContribution: optionalNumber(contribution),
        currentValue: optionalNumber(value),
        expectedMonthlyPension: optionalNumber(expected),
        rentenfaktor: optionalNumber(rentenfaktor),
        contributionDynamicPct: optionalNumber(dynamicPct),
        expectedReturnPct: optionalNumber(returnPct),
        startsOn: optionalText(startsOn),
        accountId: optionalText(accountId),
        bookingStartDate: optionalText(bookingStartDate),
        // Never reset by an edit: it records what has already been booked.
        lastBookedDate: initial?.lastBookedDate ?? null,
        note: optionalText(note),
      });
    } catch (err) {
      setError(
        isStorageFullError(err)
          ? t("common.storageFull")
          : `${t("pension.saveFailed")} ${storeErrorReason(err)}`.trim(),
      );
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.contracts.name")}</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.contracts.kind")}</span>
          <div className="mt-1">
            <SelectMenu
              value={kind}
              onChange={(v) => setKind(v as PensionContractKind)}
              options={PENSION_CONTRACT_KINDS.map((k) => ({
                value: k,
                label: t(`pension.kind.${k}`),
              }))}
            />
          </div>
        </label>
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.contracts.provider")}</span>
          <input
            className={inputCls}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.contracts.rentenfaktor")}</span>
          <input
            className={inputCls}
            inputMode="decimal"
            value={rentenfaktor}
            onChange={(e) => setRentenfaktor(stripLeadingZero(e.target.value))}
          />
          <span className="mt-1 block text-xs text-zinc-500">
            {t("pension.contracts.rentenfaktorHint")}
          </span>
        </label>

        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.contracts.contribution")}</span>
          <input
            className={inputCls}
            inputMode="decimal"
            value={contribution}
            onChange={(e) => setContribution(stripLeadingZero(e.target.value))}
          />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.contracts.currentValue")}</span>
          <input
            className={inputCls}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(stripLeadingZero(e.target.value))}
          />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.contracts.dynamic")}</span>
          <input
            className={inputCls}
            inputMode="decimal"
            value={dynamicPct}
            onChange={(e) => setDynamicPct(stripLeadingZero(e.target.value))}
          />
          <span className="mt-1 block text-xs text-zinc-500">
            {t("pension.contracts.dynamicHint")}
          </span>
        </label>
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.contracts.returnPct")}</span>
          <input
            className={inputCls}
            inputMode="decimal"
            value={returnPct}
            onChange={(e) => setReturnPct(stripLeadingZero(e.target.value))}
          />
          <span className="mt-1 block text-xs text-zinc-500">
            {t("pension.contracts.returnHint")}
          </span>
        </label>
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.contracts.startsOn")}</span>
          <input
            className={inputCls}
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </label>
        {/* A policy with a Rentenfaktor computes its payout from the premium,
            the Dynamik and the return, so a typed monthly figure would only
            contradict it. It exists for the policy whose factor the user does
            not have, and says so. */}
        {!derivesPayout && (
          <label className="block text-sm">
            <span className="text-zinc-500">{t("pension.contracts.expected")}</span>
            <input
              className={inputCls}
              inputMode="decimal"
              value={expected}
              onChange={(e) => setExpected(stripLeadingZero(e.target.value))}
            />
            <span className="mt-1 block text-xs text-zinc-500">
              {t("pension.contracts.expectedHint")}
            </span>
          </label>
        )}
        {/* The premium leaves an account like a savings plan's rate does. Due
            premiums then collect for review; nothing is ever posted silently. */}
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.contracts.account")}</span>
          <div className="mt-1">
            <SelectMenu
              ariaLabel={t("pension.contracts.account")}
              value={accountId}
              onChange={setAccountId}
              searchable={accounts.length > 8}
              options={[
                { value: "", label: t("pension.contracts.accountNone") },
                ...accounts.map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
          </div>
          <span className="mt-1 block text-xs text-zinc-500">
            {t("pension.contracts.accountHint")}
          </span>
        </label>
        {accountId !== "" && (
          <label className="block text-sm">
            <span className="text-zinc-500">{t("pension.contracts.bookingStart")}</span>
            <input
              className={inputCls}
              type="date"
              value={bookingStartDate}
              onChange={(e) => setBookingStartDate(e.target.value)}
            />
            <span className="mt-1 block text-xs text-zinc-500">
              {t("pension.contracts.bookingStartHint")}
            </span>
          </label>
        )}
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.contracts.note")}</span>
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {/* The page shows its own arithmetic: the capital first, then the factor
          applied to it. One derived number nobody can check is worth less than
          the two lines it came from. */}
      {derivesPayout && (
        <p className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-xs text-zinc-600 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-zinc-300">
          <Private>
            {preview.yearsToPayout > 0
              ? t("pension.contracts.derivedNote", {
                  capital: formatCurrency(preview.capital, base),
                  years: preview.yearsToPayout,
                  monthly: formatCurrency(preview.monthly, base),
                })
              : t("pension.contracts.derivedNoteNow", {
                  capital: formatCurrency(preview.capital, base),
                  monthly: formatCurrency(preview.monthly, base),
                })}
          </Private>
        </p>
      )}
      <FormActions error={error}>
        <Button variant="primary" onClick={submit} disabled={name.trim() === ""}>
          {submitLabel}
        </Button>
      </FormActions>
    </div>
  );
}

/**
 * The record a policy's return is measured from: what it was worth, on which
 * date. The insurer's annual statement states exactly this, which is why it is
 * asked for instead of a return percentage nobody's statement prints.
 */
function ContractValuesDialog({
  contract,
  onClose,
}: {
  contract: PensionContract;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { data, setPensionContractValues } = usePortfolio();
  const currency = data.profile.currency;

  const rows = useMemo(
    () => data.pensionContractValues.filter((v) => v.contractId === contract.id),
    [data.pensionContractValues, contract.id],
  );
  const measured = useMemo(() => contractReturn(contract, rows), [contract, rows]);

  const [date, setDate] = useState(today());
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PensionContractValue | null>(null);

  const sort = useSort<"date" | "value">("date", "desc");
  const sorted = useMemo(() => sort.apply(rows, (r, key) => r[key]), [rows, sort]);

  async function write(next: PensionContractValue[], onOk: () => void) {
    setError(null);
    try {
      await setPensionContractValues(
        contract.id,
        next.map((v) => ({ date: v.date, value: v.value })),
      );
      onOk();
    } catch (err) {
      setError(
        isStorageFullError(err)
          ? t("common.storageFull")
          : `${t("pension.saveFailed")} ${storeErrorReason(err)}`.trim(),
      );
    }
  }

  async function add() {
    const v = optionalNumber(value);
    if (v == null || !date) {
      setError(t("pension.values.invalid"));
      return;
    }
    await write(
      [...rows.filter((r) => r.date !== date), { contractId: contract.id, date, value: v }],
      () => setValue(""),
    );
  }

  return (
    <Modal open onClose={onClose} maxWidthClass="max-w-2xl">
      <Card>
        <h2 className="text-lg font-semibold">{t("pension.values.title", { name: contract.name })}</h2>
        <p className="mt-1 text-xs text-zinc-500">{t("pension.values.hint")}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-zinc-500">{t("pension.values.date")}</span>
            <input
              className={inputCls}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-500">{t("pension.values.value")}</span>
            <input
              className={inputCls}
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(stripLeadingZero(e.target.value))}
              data-private
            />
          </label>
        </div>

        {rows.length > 0 && (
          <div className="mt-4">
            <Table ariaLabel={t("pension.values.title", { name: contract.name })}>
              <Thead>
                <Th sort={sort.sort} sortKey="date" onSort={sort.toggle}>
                  {t("pension.values.date")}
                </Th>
                <Th align="right" sort={sort.sort} sortKey="value" onSort={sort.toggle}>
                  {t("pension.values.value")}
                </Th>
                <Th align="right" />
              </Thead>
              <Tbody>
                {sorted.map((row) => (
                  <Tr key={row.date}>
                    <Td>{formatDate(row.date)}</Td>
                    <Td align="right" data-private>
                      {formatCurrency(row.value, currency)}
                    </Td>
                    <Td align="right">
                      <RowActions>
                        <DeleteAction
                          label={t("common.delete")}
                          onClick={() => setPendingDelete(row)}
                        />
                      </RowActions>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}

        {/* The arithmetic behind the measured return, not just its result. */}
        <p className="mt-3 text-xs text-zinc-500">
          <Private>
            {measured
              ? t("pension.values.measured", {
                  pct: measured.pct.toFixed(2),
                  from: formatDate(measured.from.date),
                  to: formatDate(measured.to.date),
                  start: formatCurrency(measured.from.value, currency),
                  end: formatCurrency(measured.to.value, currency),
                  paid: formatCurrency(measured.contributions, currency),
                })
              : t("pension.values.needSecond")}
          </Private>
        </p>
        {measured && contract.expectedReturnPct != null && (
          <p className="mt-1 text-xs text-zinc-500">{t("pension.values.typedWins")}</p>
        )}

        <FormActions error={error}>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button variant="primary" onClick={add} disabled={value.trim() === "" || date === ""}>
            {t("pension.values.add")}
          </Button>
        </FormActions>

        {pendingDelete && (
          <ConfirmDialog
            open
            title={t("pension.values.deleteTitle")}
            message={t("pension.values.deleteMessage", { date: formatDate(pendingDelete.date) })}
            confirmLabel={t("common.delete")}
            onConfirm={async () => {
              const d = pendingDelete.date;
              await write(
                rows.filter((r) => r.date !== d),
                () => setPendingDelete(null),
              );
            }}
            onCancel={() => setPendingDelete(null)}
          />
        )}
      </Card>
    </Modal>
  );
}

type ContractSortKey =
  | "name"
  | "kind"
  | "expected"
  | "contribution"
  | "currentValue"
  | "returnPct"
  | "startsOn";

function ContractsCard() {
  const { t } = useI18n();
  const {
    data,
    addPensionContract,
    updatePensionContract,
    deletePensionContract,
    addSpendingTransaction,
  } = usePortfolio();
  const currency = data.profile.currency;
  const contracts = data.pensionContracts;

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PensionContract | null>(null);
  const [valuesOf, setValuesOf] = useState<PensionContract | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PensionContract | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);

  // Due premiums collect here and are booked only on confirmation, exactly
  // like a contract's charges or a savings plan's rate.
  const todayIso = today();
  const due = useMemo(() => pendingPremiums(contracts, todayIso), [contracts, todayIso]);
  const selectedDue = due.filter((d) => !excluded.has(`${d.contractId}:${d.date}`));
  const accountsById = useMemo(
    () => new Map(data.accounts.map((a) => [a.id, a])),
    [data.accounts],
  );

  // A booked-through date can only represent a continuous run. Toggling one
  // date therefore also toggles the later/earlier dates of that same policy.
  function togglePremium(contractId: string, date: string, checked: boolean) {
    const dates = due.filter((d) => d.contractId === contractId).map((d) => d.date);
    setExcluded((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const dueDate of dates) if (dueDate >= date) next.add(`${contractId}:${dueDate}`);
      } else {
        for (const dueDate of dates) if (dueDate <= date) next.delete(`${contractId}:${dueDate}`);
      }
      return next;
    });
  }

  /** Each store makes the row and its booked-through cursor one operation, so
   *  an interrupted review can be retried without duplicating a premium. */
  async function bookSelected() {
    setBooking(true);
    setBookError(null);
    try {
      for (const d of selectedDue) {
        await addSpendingTransaction({
          accountId: d.accountId,
          categoryId: null,
          date: d.date,
          amount: d.amount,
          payee: d.contractName,
          note: null,
          recurringId: null,
          // A premium buys an entitlement: a transfer, never consumption.
          pensionContractId: d.contractId,
        });
      }
      setExcluded(new Set());
    } catch (err) {
      setBookError(
        isStorageFullError(err)
          ? t("common.storageFull")
          : `${t("pension.saveFailed")} ${storeErrorReason(err)}`.trim(),
      );
    } finally {
      setBooking(false);
    }
  }

  // The table prints what the projection counts, so a policy with a
  // Rentenfaktor shows the derived payout rather than an empty cell.
  const settings = data.profile.pensionSettings;
  const currentYear = Number(today().slice(0, 4));
  const retirementYear =
    settings.birthYear != null
      ? Math.round(
          settings.birthYear + (settings.retirementAge ?? standardRetirementAge(settings.birthYear)),
        )
      : null;
  // The table prints what the projection counts, so it reads each policy the
  // same way: newest recorded value as capital, measured return when none was
  // typed.
  const values = data.pensionContractValues;
  const payoutOf = useCallback(
    (c: PensionContract) =>
      projectContract(resolveContract(c, values), currentYear, retirementYear).monthly,
    [currentYear, retirementYear, values],
  );
  const returnOf = useCallback(
    (c: PensionContract) => resolveContract(c, values).expectedReturnPct,
    [values],
  );
  const capitalOf = useCallback(
    (c: PensionContract) => resolveContract(c, values).currentValue,
    [values],
  );

  const sort = useSort<ContractSortKey>("name");
  const rows = useMemo(
    () =>
      sort.apply(contracts, (c, key) => {
        switch (key) {
          case "name":
            return c.name;
          case "kind":
            return c.kind;
          case "expected":
            return payoutOf(c);
          case "contribution":
            return c.monthlyContribution ?? 0;
          case "currentValue":
            return capitalOf(c) ?? 0;
          case "returnPct":
            return returnOf(c) ?? 0;
          case "startsOn":
            return c.startsOn ?? "";
        }
      }),
    [contracts, sort, payoutOf, returnOf, capitalOf],
  );
  const pager = usePagination(rows);

  const money = (v: number | null) => (v == null ? "—" : formatCurrency(v, currency));

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t("pension.contracts.title")}</h2>
          <p className="mt-1 text-xs text-zinc-500">{t("pension.contracts.hint")}</p>
        </div>
        <Button onClick={() => setAdding(true)}>{t("pension.contracts.add")}</Button>
      </div>

      {contracts.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">{t("pension.contracts.empty")}</p>
      ) : (
        <div className="mt-4">
          <Table ariaLabel={t("pension.contracts.title")}>
            <Thead>
              <Th sort={sort.sort} sortKey="name" onSort={sort.toggle}>
                {t("pension.contracts.name")}
              </Th>
              <Th sort={sort.sort} sortKey="kind" onSort={sort.toggle}>
                {t("pension.contracts.kind")}
              </Th>
              <Th align="right" sort={sort.sort} sortKey="expected" onSort={sort.toggle}>
                {t("pension.contracts.expected")}
              </Th>
              <Th align="right" sort={sort.sort} sortKey="contribution" onSort={sort.toggle}>
                {t("pension.contracts.contribution")}
              </Th>
              <Th align="right" sort={sort.sort} sortKey="currentValue" onSort={sort.toggle}>
                {t("pension.contracts.currentValue")}
              </Th>
              <Th align="right" sort={sort.sort} sortKey="returnPct" onSort={sort.toggle}>
                {t("pension.contracts.returnColumn")}
              </Th>
              <Th sort={sort.sort} sortKey="startsOn" onSort={sort.toggle}>
                {t("pension.contracts.startsOn")}
              </Th>
              <Th align="right" />
            </Thead>
            <Tbody>
              {pager.rows.map((c) => (
                <Tr key={c.id}>
                  <Td>{c.name}</Td>
                  <Td className="text-zinc-500">{t(`pension.kind.${c.kind}`)}</Td>
                  <Td align="right">{money(payoutOf(c) || null)}</Td>
                  <Td align="right">{money(c.monthlyContribution)}</Td>
                  <Td align="right">{money(capitalOf(c))}</Td>
                  <Td align="right">
                    {returnOf(c) == null ? "—" : `${returnOf(c)!.toFixed(2)} %`}
                  </Td>
                  <Td className="text-zinc-500">{c.startsOn ?? "—"}</Td>
                  <Td align="right">
                    <RowActions>
                      <EditAction label={t("pension.edit")} onClick={() => setEditing(c)} />
                      <HistoryAction
                        label={t("pension.values.open")}
                        onClick={() => setValuesOf(c)}
                      />
                      <DeleteAction label={t("common.delete")} onClick={() => setPendingDelete(c)} />
                    </RowActions>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <TablePagination pager={pager} />
        </div>
      )}

      {due.length > 0 && (
        <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 className="text-sm font-semibold">
            {t("pension.premiums.title", { n: String(due.length) })}
          </h3>
          <ul className="mt-3 space-y-2">
            {due.map((d) => {
              const key = `${d.contractId}:${d.date}`;
              const checked = !excluded.has(key);
              const cur = accountsById.get(d.accountId)?.currency || currency;
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
                >
                  <label className="flex flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePremium(d.contractId, d.date, checked)}
                      className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
                    />
                    <span className={checked ? "" : "text-zinc-400 line-through"} data-private>
                      {d.contractName} <span className="text-zinc-500">{formatDate(d.date)}</span>
                    </span>
                  </label>
                  <span
                    className={`tabular-nums ${
                      checked ? "text-red-600 dark:text-red-400" : "text-zinc-400 line-through"
                    }`}
                    data-private
                  >
                    {formatCurrency(d.amount, cur)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-zinc-500">{t("pension.premiums.transferNote")}</p>
          {bookError && <p className="mt-2 text-sm text-red-600">{bookError}</p>}
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
            <Button
              variant="primary"
              disabled={booking || selectedDue.length === 0}
              onClick={() => void bookSelected()}
            >
              {t("pension.premiums.book", { n: String(selectedDue.length) })}
            </Button>
          </div>
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)}>
        <Card>
          <h2 className="text-lg font-semibold">{t("pension.contracts.add")}</h2>
          <div className="mt-4">
            <ContractForm
              onSubmit={async (input) => {
                await addPensionContract(input);
                setAdding(false);
              }}
              submitLabel={t("pension.contracts.add")}
            />
          </div>
        </Card>
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)}>
        {editing && (
          <Card>
            <h2 className="text-lg font-semibold">{t("pension.contracts.edit")}</h2>
            <div className="mt-4">
              {/* Keyed on the policy so opening another row re-seeds the fields. */}
              <ContractForm
                key={editing.id}
                initial={editing}
                onSubmit={async (input) => {
                  await updatePensionContract(editing.id, input);
                  setEditing(null);
                }}
                submitLabel={t("pension.save")}
              />
            </div>
          </Card>
        )}
      </Modal>

      {valuesOf && (
        <ContractValuesDialog
          key={valuesOf.id}
          contract={valuesOf}
          onClose={() => setValuesOf(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          open
          title={t("pension.contracts.deleteTitle")}
          message={t("pension.contracts.deleteMessage", { name: pendingDelete.name })}
          confirmLabel={t("common.delete")}
          onConfirm={async () => {
            await deletePensionContract(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function PensionView() {
  const { t } = useI18n();
  const { data } = usePortfolio();
  const reference = usePensionReference();
  const currency = data.profile.currency;
  const currentYear = new Date().getFullYear();

  const projection = useMemo(
    () =>
      projectPension({
        entries: data.pensionPoints,
        statements: data.pensionStatements,
        contracts: data.pensionContracts,
        contractValues: data.pensionContractValues,
        reference,
        settings: data.profile.pensionSettings,
        currentYear,
      }),
    [
      data.pensionPoints,
      data.pensionStatements,
      data.pensionContracts,
      data.pensionContractValues,
      data.profile.pensionSettings,
      reference,
      currentYear,
    ],
  );

  const level = pensionLevelOn(reference, currentYear);
  // No Rentenwert (no Supabase, or the table was never seeded) means no euro
  // figure at all — the points still stand on their own.
  const money = (v: number | null) => (v == null ? "—" : formatCurrency(v, currency));

  return (
    <div className="space-y-6">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-tour="pension-summary">
          <Stat label={t("pension.stat.points")} value={projection.totalPoints.toFixed(2)} />
          <Stat label={t("pension.stat.statutory")} value={money(projection.monthlyStatutory)} isPrivate />
          <Stat label={t("pension.stat.private")} value={money(projection.monthlyPrivate)} isPrivate />
          <Stat label={t("pension.stat.total")} value={money(projection.monthlyTotal)} isPrivate />
        </div>
        <div className="mt-4 grid gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-zinc-800">
          <Stat label={t("pension.stat.earned")} value={money(projection.monthlyEarned)} isPrivate />
          <Stat
            label={t("pension.stat.retirementYear")}
            value={projection.retirementYear != null ? String(projection.retirementYear) : "—"}
          />
          <Stat label={t("pension.stat.accessFactor")} value={projection.accessFactor.toFixed(3)} />
          <Stat
            label={t("pension.stat.level")}
            value={level != null ? `${level.toFixed(1)} %` : "—"}
          />
        </div>
        {/* The projection's own arithmetic, in full. A single number cannot be
            argued with when it disagrees with the Renteninformation; these two
            lines say which input is responsible. */}
        <p className="mt-4 text-xs text-zinc-500">
          {t("pension.calc.points", {
            current: projection.currentPoints.toFixed(2),
            annual: projection.annualPoints.toFixed(2),
            years: String(
              projection.retirementYear != null
                ? Math.max(0, projection.retirementYear - new Date().getFullYear())
                : 0,
            ),
            total: projection.totalPoints.toFixed(2),
          })}
          {projection.pensionValue != null && (
            <>
              {" "}
              <Private>
                {t("pension.calc.money", {
                  total: projection.totalPoints.toFixed(2),
                  value: formatCurrency(projection.pensionValue, currency),
                  factor: projection.accessFactor.toFixed(3),
                  monthly: money(projection.monthlyStatutory),
                })}
              </Private>
            </>
          )}
        </p>
        {projection.annualPointsSlope !== 0 && (
          <p className="mt-1 text-xs text-zinc-500">
            {t("pension.calc.trend", {
              start: projection.annualPointsStart.toFixed(2),
              end: projection.annualPointsEnd.toFixed(2),
              years: String(projection.trendSampleSize),
            })}
          </p>
        )}
        {projection.outlierYear && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            {t("pension.outlierNotice", {
              year: String(projection.outlierYear.year),
              points: projection.outlierYear.points.toFixed(2),
            })}
          </p>
        )}
        {projection.annualPointsCapped && projection.maxAnnualPoints != null && (
          <p className="mt-4 text-sm text-amber-700 dark:text-amber-400">
            {t("pension.cappedNotice", {
              raw: projection.rawAnnualPoints.toFixed(2),
              max: projection.maxAnnualPoints.toFixed(2),
            })}
          </p>
        )}
        {projection.gap > 0 && (
          <p className="mt-4 text-sm text-amber-700 dark:text-amber-400">
            <Private>{t("pension.gap", { amount: formatCurrency(projection.gap, currency) })}</Private>
          </p>
        )}
        <p className="mt-4 text-xs text-zinc-500">{t("pension.todaysMoney")}</p>
      </Card>

      <div data-tour="pension-assumptions">
        <AssumptionsCard projection={projection} />
      </div>
      <div data-tour="pension-points">
        <PointsCard maxPoints={projection.maxAnnualPoints} />
      </div>
      <div data-tour="pension-contracts">
        <ContractsCard />
      </div>
    </div>
  );
}
