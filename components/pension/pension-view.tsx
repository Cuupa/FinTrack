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

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import {
  pensionLevelOn,
  projectPension,
  standardRetirementAge,
  type PensionProjection,
} from "@/lib/finance/pension";
import { usePensionReference } from "@/lib/pension/use-pension-reference";
import {
  PENSION_CONTRACT_KINDS,
  type PensionContract,
  type PensionContractKind,
  type PensionPoint,
} from "@/lib/types";
import type { PensionContractInput } from "@/lib/store/types";
import { formatCurrency, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card, Stat } from "@/components/ui/primitives";
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
import { DeleteAction, EditAction, RowActions } from "@/components/ui/row-actions";
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

/**
 * The cumulative figure the Renteninformation actually leads with. It used to
 * have nowhere to go, so it was typed into a year's row and the projection read
 * it as an annual rate -- 17 points became ~20.000 EUR a month. Its own field,
 * with its own as-of year, above the year-by-year detail.
 */
function TotalPointsFields({ maxPoints }: { maxPoints: number | null }) {
  const { t } = useI18n();
  const { data, updateProfile } = usePortfolio();
  const settings = data.profile.pensionSettings;

  const [total, setTotal] = useState(
    settings.totalPoints != null ? String(settings.totalPoints) : "",
  );
  const [asOf, setAsOf] = useState(
    settings.totalPointsYear != null ? String(settings.totalPointsYear) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setError(null);
    setSaved(false);
    try {
      await updateProfile({
        pensionSettings: {
          ...settings,
          totalPoints: optionalNumber(total),
          totalPointsYear: optionalNumber(asOf),
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
    <div>
      <h3 className="text-sm font-medium">{t("pension.total.title")}</h3>
      <p className="mt-1 text-xs text-zinc-500">
        {maxPoints != null
          ? t("pension.total.hintMax", { max: maxPoints.toFixed(2) })
          : t("pension.total.hint")}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.total.points")}</span>
          <input
            className={inputCls}
            inputMode="decimal"
            value={total}
            onChange={(e) => {
              setTotal(stripLeadingZero(e.target.value));
              setSaved(false);
            }}
            placeholder="17,0322"
          />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.total.year")}</span>
          <input
            className={inputCls}
            inputMode="numeric"
            value={asOf}
            onChange={(e) => {
              setAsOf(stripLeadingZero(e.target.value));
              setSaved(false);
            }}
            placeholder={String(new Date().getFullYear())}
          />
        </label>
        <div className="flex items-end gap-3 sm:col-span-2">
          <Button onClick={save}>{t("pension.save")}</Button>
          {saved && <span className="pb-2 text-xs text-emerald-600">{t("pension.saved")}</span>}
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function PointsCard({ maxPoints }: { maxPoints: number | null }) {
  const { t } = useI18n();
  const { data, setPensionPoints } = usePortfolio();
  const entries = data.pensionPoints;

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
        <TotalPointsFields maxPoints={maxPoints} />
      </div>

      <h3 className="mt-6 border-t border-zinc-100 pt-4 text-sm font-medium dark:border-zinc-800">
        {t("pension.points.detailTitle")}
      </h3>
      <p className="mt-1 text-xs text-zinc-500">{t("pension.points.hint")}</p>

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
      <div className="mt-3">
        <Button onClick={add} disabled={year.trim() === "" || points.trim() === ""}>
          {t("pension.points.add")}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

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
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState<string | null>(null);

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
        startsOn: optionalText(startsOn),
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
          <span className="text-zinc-500">{t("pension.contracts.expected")}</span>
          <input
            className={inputCls}
            inputMode="decimal"
            value={expected}
            onChange={(e) => setExpected(stripLeadingZero(e.target.value))}
          />
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
          <span className="text-zinc-500">{t("pension.contracts.startsOn")}</span>
          <input
            className={inputCls}
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-500">{t("pension.contracts.note")}</span>
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <Button onClick={submit} disabled={name.trim() === ""}>
        {submitLabel}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

type ContractSortKey = "name" | "kind" | "expected" | "contribution" | "currentValue" | "startsOn";

function ContractsCard() {
  const { t } = useI18n();
  const { data, addPensionContract, updatePensionContract, deletePensionContract } = usePortfolio();
  const currency = data.profile.currency;
  const contracts = data.pensionContracts;

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PensionContract | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PensionContract | null>(null);

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
            return c.expectedMonthlyPension ?? 0;
          case "contribution":
            return c.monthlyContribution ?? 0;
          case "currentValue":
            return c.currentValue ?? 0;
          case "startsOn":
            return c.startsOn ?? "";
        }
      }),
    [contracts, sort],
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
                  <Td align="right">{money(c.expectedMonthlyPension)}</Td>
                  <Td align="right">{money(c.monthlyContribution)}</Td>
                  <Td align="right">{money(c.currentValue)}</Td>
                  <Td className="text-zinc-500">{c.startsOn ?? "—"}</Td>
                  <Td align="right">
                    <RowActions>
                      <EditAction label={t("pension.edit")} onClick={() => setEditing(c)} />
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
        contracts: data.pensionContracts,
        reference,
        settings: data.profile.pensionSettings,
        currentYear,
      }),
    [
      data.pensionPoints,
      data.pensionContracts,
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
          <Stat label={t("pension.stat.statutory")} value={money(projection.monthlyStatutory)} />
          <Stat label={t("pension.stat.private")} value={money(projection.monthlyPrivate)} />
          <Stat label={t("pension.stat.total")} value={money(projection.monthlyTotal)} />
        </div>
        <div className="mt-4 grid gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-zinc-800">
          <Stat label={t("pension.stat.earned")} value={money(projection.monthlyEarned)} />
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
              {t("pension.calc.money", {
                total: projection.totalPoints.toFixed(2),
                value: formatCurrency(projection.pensionValue, currency),
                factor: projection.accessFactor.toFixed(3),
                monthly: money(projection.monthlyStatutory),
              })}
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
            {t("pension.gap", { amount: formatCurrency(projection.gap, currency) })}
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
