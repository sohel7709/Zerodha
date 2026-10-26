import React, { useState, useEffect } from "react";
import { socket } from "../socket";
import { useNavigate } from "react-router-dom";

const getInitialIndexes = () => {
  try {
    const raw = localStorage.getItem("cached_indexes");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const IndexTicker = () => {
  const [indexes, setIndexes] = useState(getInitialIndexes);
  const [connected, setConnected] = useState(socket.connected);
  const navigate = useNavigate();

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    const onMarketData = (data) => {
      if (data.indexes) {
        setIndexes(data.indexes);
        try { localStorage.setItem("cached_indexes", JSON.stringify(data.indexes)); } catch {}
      }
    };

    const onPriceTick = (tick) => {
      if (tick.isIndex && tick.symbol) {
        setIndexes(prev => {
          const existing = prev[tick.symbol] || {};
          const updated = {
            ...prev,
            [tick.symbol]: {
              ...existing,
              name: tick.symbol,
              ltp: tick.ltp,
              change: tick.change,
              changePercent: tick.changePercent,
            }
          };
          return updated;
        });
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("marketData", onMarketData);
    socket.on("priceTick", onPriceTick);

    if (socket.connected) setConnected(true);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("marketData", onMarketData);
      socket.off("priceTick", onPriceTick);
    };
  }, []);

  const formatNumber = (num) => {
    if (!num) return "0";
    return num.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  };

  const indexList = Object.values(indexes);

  if (indexList.length === 0) {
    return (
      <div className="index-ticker">
        <p style={{ color: "#888", fontSize: "0.8rem" }}>
          {connected ? "Waiting for market data..." : "Connecting..."}
        </p>
      </div>
    );
  }

  return (
    <div className="index-ticker">
      {indexList.map((idx, i) => (
        <div className="index-item" key={i} onClick={() => navigate("/index-charts")}
          style={{ cursor: "pointer" }} title="View index charts">
          <span className="index-name">{idx.name || idx.symbol}</span>
          <span className="index-value">{formatNumber(idx.ltp)}</span>
          <span
            className={`index-change ${
              (idx.changePercent || idx.change || 0) >= 0 ? "profit" : "loss"
            }`}
          >
            {(idx.changePercent || idx.change || 0) >= 0 ? "+" : ""}
            {typeof idx.changePercent === "number"
              ? idx.changePercent.toFixed(2)
              : "0.00"}
            %
          </span>
        </div>
      ))}
    </div>
  );
};

export default IndexTicker;