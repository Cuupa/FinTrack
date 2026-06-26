# Product Requirement Document (PRD) – Financial Platform

## 1. Objectives & Target Audience

The objective is to develop a modern, high-performance web application for financial planning and asset tracking. The application caters to casual users via a Guest Mode as well as ambitious retail investors via a Registered Mode who require detailed portfolio analytics and long-term forecasting tools.

---

## 2. User Modes & Authentication

### 2.1 Guest Mode

* **Functionality:** Access to core tracking and planning features.
* **Data Retention:** Temporary storage of user inputs (e.g., utilizing browser LocalStorage or SessionStorage).
* **Limitations:** No persistent database storage. Data is lost upon closing the session or clearing the browser cache. Informational banners will notify the user of this behavior.

### 2.2 Registered Mode

* **Authentication:** User registration and login managed via Supabase Auth (Email/Password and optional OAuth providers such as Google or GitHub).
* **Data Retention:** Full, secure persistence of all assets, transactions, and historical data within the Supabase database.
* **Synchronization:** Multi-device synchronization enabled by cloud-based data storage.

---

## 3. Functional Requirements

### 3.1 Financial Tracking

* **Asset Types:** Support for ETFs, stocks, cryptocurrencies, and cash positions.
* **Manual Asset Entry:**
* Input form capturing Ticker symbol (e.g., AAPL, VWCE).
* Input fields for quantity, purchase price, transaction date, and associated fees.
* Validation of ticker symbols against a financial data API.


* **Transaction History:** Support for buy and sell events per asset to accurately reconstruct historical portfolio holdings.

### 3.2 Visualization & Charts

* **Timeframes:** Toggleable views for the following intervals: 1W, 1M, 3M, YTD, 1Y, 5Y, 10Y, MAX.
* **Scaling:** Switch component to alternate between linear (normal) and logarithmic chart scales.
* **Metrics:** Toggleable display between absolute values (in the chosen base currency, e.g., EUR) and relative values (percentage performance).

### 3.3 Financial Planning

* **Monte Carlo Simulation:**
* **Input Parameters:** Initial capital, monthly contribution, investment horizon (in years), expected average annual return, and volatility (standard deviation).
* **Computation:** Execution of at least 1,000 simulation runs in the background.
* **Output:** Graphical representation of probability distributions (best-case, median, worst-case) for future wealth accumulation.



---

## 4. UI/UX & Layout Specifications

### 4.1 Hero Section

* **Global Dashboard View (Main Page):**
* Central line chart showcasing historical net worth evolution.
* Controls for timeframe, scaling (Linear vs. Logarithmic), and display mode (Currency vs. Percentage).


* **Asset-Specific View (Detail Page):**
* Dedicated line chart for the selected asset.
* Visual indicators (e.g., colored markers or vertical lines) on the timeline representing specific buy and sell events.



### 4.2 Main Content

* **Asset Table:**
* Columns: Name, Ticker, WKN/ISIN, current price, total holdings (shares), current total value, performance (absolute/percentage).
* Sorting and filtering capabilities across all relevant columns.


* **Detail Panel / Overlay (On Asset Selection):**
* Display of advanced metrics:
* Internal Rate of Return (IRR)
* Master data: WKN, ISIN, asset name
* Dividend history and dividend yield
* Realized and unrealized profit/loss statements


---

## 5. Technical Infrastructure & Data Model

### 5.1 System Architecture

* **Frontend:** Modern Next.js paired with a responsive UI library (Tailwind CSS).
* **Backend & Database:** Supabase (PostgreSQL) handling data persistence, real-time updates, and authentication.
* **Charts:** High-performance charting library (e.g., Recharts, Chart.js, or Shadcn-charts).

### 5.2 Preliminary Data Model (Supabase Tables)

| Table | Description | Key Fields |
| --- | --- | --- |
| `profiles` | User profile configurations | id (auth.uuid), currency, created_at |
| `assets` | Manually created or system-wide assets | id, ticker, isin, wkn, name, type |
| `user_assets` | Mapping of assets to specific users (registered only) | id, user_id, asset_id, notes |
| `transactions` | Buy and sell events | id, user_asset_id, type (BUY/SELL), quantity, price, fee, date |
