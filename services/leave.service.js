const DAYS_PER_YEAR = 365;
const ANNUAL_LEAVE_ENTITLEMENT = 21;
const DAILY_ACCRUAL_RATE = ANNUAL_LEAVE_ENTITLEMENT / DAYS_PER_YEAR;

/**
 * Validate a date supplied in YYYY-MM-DD format.
 * Uses UTC to avoid time-zone differences in date calculations.
 */
function parseDateOnly(dateString, fieldName) {
  if (
    typeof dateString !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(dateString)
  ) {
    throw new Error(`${fieldName} must use YYYY-MM-DD format.`);
  }

  const date = new Date(`${dateString}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== dateString
  ) {
    throw new Error(`${fieldName} is not a valid date.`);
  }

  return date;
}

/**
 * Return today's date in the Africa/Nairobi time zone.
 */
function getNairobiDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const year = parts.find(part => part.type === "year").value;
  const month = parts.find(part => part.type === "month").value;
  const day = parts.find(part => part.type === "day").value;

  return `${year}-${month}-${day}`;
}

/**
 * Count calendar days inclusively.
 * Returns zero if the end date is before the start date.
 */
function countCalendarDaysInclusive(startDate, endDate) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  if (endDate < startDate) {
    return 0;
  }

  return Math.floor(
    (endDate.getTime() - startDate.getTime()) / millisecondsPerDay
  ) + 1;
}

/**
 * Calculate the accrued annual leave balance before deductions.
 *
 * New employees:
 * Accrual starts on employmentStartDate.
 *
 * Existing employees:
 * Accrual starts the day after openingBalanceAsOf.
 *
 * The returned balance is not rounded, preserving fractional accuracy.
 */
function calculateAccruedLeaveBalance({
  employmentStartDate,
  openingBalance = 0,
  openingBalanceAsOf = null,
  asOfDate = getNairobiDate()
}) {
  if (
    typeof openingBalance !== "number" ||
    !Number.isFinite(openingBalance) ||
    openingBalance < 0 ||
    openingBalance > 365
  ) {
    throw new Error("Opening balance must be between 0 and 365 days.");
  }

  const endDate = parseDateOnly(asOfDate, "asOfDate");
  let startingDate;
  let startingBalance = 0;

  if (openingBalanceAsOf) {
    const effectiveDate = parseDateOnly(
      openingBalanceAsOf,
      "openingBalanceAsOf"
    );

    if (effectiveDate > endDate) {
      throw new Error("Opening balance date cannot be after the calculation date.");
    }

    // The opening balance already includes leave up to its effective date.
    // Future accrual begins the following day.
    startingDate = new Date(effectiveDate.getTime() + 86400000);
    startingBalance = openingBalance;
  } else {
    if (!employmentStartDate) {
      throw new Error(
        "Employment start date is required when no opening balance exists."
      );
    }

    startingDate = parseDateOnly(
      employmentStartDate,
      "employmentStartDate"
    );

    if (startingDate > endDate) {
      throw new Error("Employment start date cannot be in the future.");
    }
  }

  const accruedDays = countCalendarDaysInclusive(startingDate, endDate);
  const accruedLeave = accruedDays * DAILY_ACCRUAL_RATE;

  return {
    startingBalance,
    accruedDays,
    accruedLeave,
    totalBeforeDeductions: startingBalance + accruedLeave
  };
}

module.exports = {
  ANNUAL_LEAVE_ENTITLEMENT,
  DAYS_PER_YEAR,
  DAILY_ACCRUAL_RATE,
  getNairobiDate,
  calculateAccruedLeaveBalance
};