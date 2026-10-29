import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { socket } from "../socket";

const Holdings = () => {
  const [allHoldings, setAllHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  // Keep a ref so socket handlers always see the latest holdings array
  const holdingsRef = useRef([]);

  useEffect(() => {
    axios.get('https://zerodha-production-production.up.railway.app/allHoldings')
      .then(res => {
        holdingsRef.current = res.data;
        setAllHoldings(res.data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching holdings:', err);
        setAllHoldings([]);
        setLoading(false);
      });

    // Live price updates via sub-50ms priceTick events
    const onPriceTick = ({ symbol, ltp, change, changePercent }) => {
      if (!symbol || !ltp) return;
      const sym = symbol.toUpperCase();
      const updated = holdingsRef.current.map(h =>
        h.stockSymbol === sym
          ? { ...h, ltp, change: change ?? h.change, changePercent: changePercent ?? h.changePercent }
          : h
      );
      holdingsRef.current = updated;
      setAllHoldings(updated);
    };

    // Bulk refresh on every marketData broadcast (handles symbols not yet in priceTick)
    const onMarketData = ({ prices }) => {
      if (!prices || holdingsRef.current.length === 0) return;
      let changed = false;
      const updated = holdingsRef.current.map(h => {
        const p = prices[h.stockSymbol];
        if (!p || !p.ltp) return h;
        changed = true;
        return { ...h, ltp: p.ltp, change: p.change ?? h.change, changePercent: p.changePercent ?? h.changePercent };
      });
      if (changed) {
        holdingsRef.current = updated;
        setAllHoldings(updated);
      }
    };

    // Refresh holdings from initialData broadcast (e.g. after reconnect)
    const onInitialData = ({ holdings }) => {
      if (!holdings || holdings.length === 0) return;
      holdingsRef.current = holdings;
      setAllHoldings(holdings);
    };

    socket.on('priceTick', onPriceTick);
    socket.on('marketData', onMarketData);
    socket.on('initialData', onInitialData);

    return () => {
      socket.off('priceTick', onPriceTick);
      socket.off('marketData', onMarketData);
      socket.off('initialData', onInitialData);
    };
  }, []);

  if (loading) return <><h3 className="title">Holdings</h3><p>Loading...</p></>;

  const totalInvestment = allHoldings.reduce((sum, s) => sum + (s.avgPrice * s.quantity), 0);
  const currentValue = allHoldings.reduce((sum, s) => sum + (s.ltp * s.quantity), 0);
  const totalPL = currentValue - totalInvestment;
  const plPercent = totalInvestment > 0 ? ((totalPL / totalInvestment) * 100).toFixed(2) : 0;

  return (
    <>
      <h3 className="title">Holdings ({allHoldings.length})</h3>

      <div className="order-table">
        <table>
          <thead>
            <tr>
              <th>Instrument</th>
              <th>Qty.</th>
              <th>Avg. cost</th>
              <th>LTP</th>
              <th>Cur. val</th>
              <th>P&L</th>
              <th>P&L %</th>
            </tr>
          </thead>
          <tbody>
            {allHoldings.map((stock, index) => {
              const currValue = stock.ltp * stock.quantity;
              const pl = currValue - (stock.avgPrice * stock.quantity);
              const isProfit = pl >= 0;
              const profClass = isProfit ? "profit" : "loss";
              const plPercentVal = stock.avgPrice > 0 ? (((stock.ltp - stock.avgPrice) / stock.avgPrice) * 100).toFixed(2) : 0;
              return (
                <tr key={index}>
                  <td>{stock.stockSymbol}</td>
                  <td>{stock.quantity}</td>
                  <td>{stock.avgPrice.toFixed(2)}</td>
                  <td>{stock.ltp.toFixed(2)}</td>
                  <td>{currValue.toFixed(2)}</td>
                  <td className={profClass}>{pl.toFixed(2)}</td>
                  <td className={profClass}>{isProfit ? '+' : ''}{plPercentVal}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="row">
        <div className="col">
          <h5>{totalInvestment.toFixed(2)}</h5>
          <p>Total investment</p>
        </div>
        <div className="col">
          <h5>{currentValue.toFixed(2)}</h5>
          <p>Current value</p>
        </div>
        <div className="col">
          <h5 className={totalPL >= 0 ? "profit" : "loss"}>
            {totalPL.toFixed(2)} ({totalPL >= 0 ? '+' : ''}{plPercent}%)
          </h5>
          <p>P&L</p>
        </div>
      </div>
    </>
  );
};

export default Holdings;