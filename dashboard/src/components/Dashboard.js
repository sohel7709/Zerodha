import React, { Suspense, lazy } from "react";
import { Route, Routes } from "react-router-dom";

// Primary tabs loaded immediately for 0ms initial navigation
import Summary from "./Summary";
import Orders from "./Orders";
import Holdings from "./Holdings";
import Positions from "./Positions";
import Funds from "./Funds";
import WatchList from "./WatchList";
import { GeneralContextProvider } from "./GeneralContext";

// Secondary heavy pages lazy loaded on demand (drastically slashes initial bundle size)
const Apps = lazy(() => import("./Apps"));
const MarketMovers = lazy(() => import("./MarketMovers"));
const StockChart = lazy(() => import("./StockChart"));
const TradeBook = lazy(() => import("./TradeBook"));
const PLStatement = lazy(() => import("./PLStatement"));
const TaxPnL = lazy(() => import("./TaxPnL"));
const IndexCharts = lazy(() => import("./IndexCharts"));
const Notifications = lazy(() => import("./Notifications"));
const AdminDashboard = lazy(() => import("./AdminDashboard"));
const TradingViewWidget = lazy(() => import("./TradingViewWidget"));
const HistoricalData = lazy(() => import("./HistoricalData"));
const LiveChat = lazy(() => import("./LiveChat"));

const TabFallback = () => (
  <div style={{ padding: 40, textAlign: "center", color: "#888", fontSize: "0.9rem" }}>
    Loading section...
  </div>
);

const Dashboard = () => {
  return (
    <div className="dashboard-container">
      <GeneralContextProvider>
        <WatchList />
      </GeneralContextProvider>
      <div className="content">
        <Suspense fallback={<TabFallback />}>
          <Routes>
            <Route exact path="/" element={<Summary />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/holdings" element={<Holdings />} />
            <Route path="/positions" element={<Positions />} />
            <Route path="/funds" element={<Funds />} />
            <Route path="/apps" element={<Apps />} />
            <Route path="/movers" element={<MarketMovers />} />
            <Route path="/chart" element={<StockChart />} />
            <Route path="/trades" element={<TradeBook />} />
            <Route path="/pl" element={<PLStatement />} />
            <Route path="/tax-pnl" element={<TaxPnL />} />
            <Route path="/index-charts" element={<IndexCharts />} />
            <Route path="/alerts" element={<Notifications />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/tradingview" element={<TradingViewWidget />} />
            <Route path="/history" element={<HistoricalData />} />
            <Route path="/chat" element={<LiveChat />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  );
};

export default Dashboard;
