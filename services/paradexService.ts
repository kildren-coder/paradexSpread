import { MarketTicker, OrderBook, OrderLevel } from '../types';

// Configuration
const PARADEX_WS_URL = 'wss://ws.api.prod.paradex.trade/v1';
const TARGET_SPREAD_THRESHOLD = 0.00001; // 0.001% target

// Default symbols if API fetch fails or for initial load
const DEFAULT_SYMBOLS = [
  'BTC-USD-PERP', 'ETH-USD-PERP', 'SOL-USD-PERP', 
  'ARB-USD-PERP', 'DOGE-USD-PERP', 'SUI-USD-PERP', 
  'LINK-USD-PERP', 'AVAX-USD-PERP', 'WIF-USD-PERP',
  'PEPE-USD-PERP', 'TIA-USD-PERP', 'STRK-USD-PERP'
];

interface WsMessage {
  jsonrpc: string;
  method: string;
  params?: {
    channel: string;
    data: any;
  };
}

// Paradex raw order book format: [price, size] as strings
type RawLevel = [string, string];

class ParadexService {
  private ws: WebSocket | null = null;
  private subscribers: ((data: MarketTicker[]) => void)[] = [];
  private localOrderBooks: Map<string, { bids: Map<number, number>; asks: Map<number, number> }> = new Map();
  private marketTickers: Map<string, MarketTicker> = new Map();
  private symbols: string[] = DEFAULT_SYMBOLS;
  private reconnectTimer: any = null;
  private isConnecting: boolean = false;

  constructor() {
    this.init();
  }

  private async init() {
    // 1. Try to fetch available markets (fallback to defaults if fails)
    try {
      const response = await fetch('https://api.prod.paradex.trade/v1/markets');
      if (response.ok) {
        const json = await response.json();
        // Filter for active PERP markets
        this.symbols = json.results
          .filter((m: any) => m.symbol.endsWith('-PERP'))
          .map((m: any) => m.symbol)
          .slice(0, 20); // Limit to top 20 to save bandwidth for this demo
      }
    } catch (e) {
      console.warn('Failed to fetch markets list, using defaults', e);
    }

    // 2. Connect WS
    this.connect();
  }

  private connect() {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) return;
    this.isConnecting = true;

    this.ws = new WebSocket(PARADEX_WS_URL);

    this.ws.onopen = () => {
      this.isConnecting = false;
      console.log('Connected to Paradex WS');
      this.subscribeToMarkets();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch (e) {
        console.error('Parse error', e);
      }
    };

    this.ws.onclose = () => {
      this.isConnecting = false;
      console.log('Paradex WS closed, reconnecting in 3s...');
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error('Paradex WS error', err);
      this.ws?.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
  }

  private subscribeToMarkets() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.symbols.forEach(symbol => {
      // Initialize local book storage
      if (!this.localOrderBooks.has(symbol)) {
        this.localOrderBooks.set(symbol, { bids: new Map(), asks: new Map() });
      }

      // Send JSON-RPC subscribe
      const payload = {
        jsonrpc: "2.0",
        method: "subscribe",
        params: {
          channel: "order_book",
          market: symbol
        },
        id: Date.now()
      };
      this.ws.send(JSON.stringify(payload));
    });
  }

  private handleMessage(msg: WsMessage) {
    if (msg.method === 'subscription_update' && msg.params?.channel === 'order_book') {
      const { market, bids, asks } = msg.params.data;
      this.processOrderBookUpdate(market, bids, asks);
    }
  }

  private processOrderBookUpdate(symbol: string, rawBids: RawLevel[], rawAsks: RawLevel[]) {
    const book = this.localOrderBooks.get(symbol);
    if (!book) return;

    // Helper to update the map
    // If size is '0', delete the level. Otherwise set it.
    const updateLevels = (map: Map<number, number>, levels: RawLevel[]) => {
      levels.forEach(([priceStr, sizeStr]) => {
        const price = parseFloat(priceStr);
        const size = parseFloat(sizeStr);
        if (size === 0) {
          map.delete(price);
        } else {
          map.set(price, size);
        }
      });
    };

    updateLevels(book.bids, rawBids || []);
    updateLevels(book.asks, rawAsks || []);

    // Convert Map to sorted Arrays for metrics calculation
    // Bids: High to Low
    const sortedBids: OrderLevel[] = Array.from(book.bids.entries())
      .map(([price, size]) => ({ price, size }))
      .sort((a, b) => b.price - a.price);

    // Asks: Low to High
    const sortedAsks: OrderLevel[] = Array.from(book.asks.entries())
      .map(([price, size]) => ({ price, size }))
      .sort((a, b) => a.price - b.price);

    if (sortedBids.length > 0 && sortedAsks.length > 0) {
      const ticker = this.calculateMetrics(symbol, sortedBids, sortedAsks);
      this.marketTickers.set(symbol, ticker);
      
      // Throttle updates to UI slightly to avoid React render spam? 
      // For now, we just notify on every update. In high freq this might need a debounce.
      this.notify();
    }
  }

  private calculateMetrics(symbol: string, bids: OrderLevel[], asks: OrderLevel[]): MarketTicker {
    const bestBid = bids[0].price;
    const bestAsk = asks[0].price;
    const midPrice = (bestBid + bestAsk) / 2;
    
    // Calculate raw spread
    const spread = bestAsk - bestBid;
    const spreadPct = spread / bestBid; // using bestBid as denominator is standard

    // Calculate liquidity STRICTLY within the 0.001% threshold relative to best price
    // Range is defined as:
    // Bid Side: [bestBid * (1 - 0.001%), bestBid]
    // Ask Side: [bestAsk, bestAsk * (1 + 0.001%)]
    
    const bidCutoff = bestBid * (1 - TARGET_SPREAD_THRESHOLD);
    const askCutoff = bestAsk * (1 + TARGET_SPREAD_THRESHOLD);

    let bidLiquidity = 0;
    let askLiquidity = 0;

    // Sum bids down to cutoff
    for (const level of bids) {
      if (level.price >= bidCutoff) {
        bidLiquidity += level.size;
      } else {
        break; // Sorted descending, so we can stop early
      }
    }

    // Sum asks up to cutoff
    for (const level of asks) {
      if (level.price <= askCutoff) {
        askLiquidity += level.size;
      } else {
        break; // Sorted ascending, so we can stop early
      }
    }

    return {
      symbol,
      price: midPrice,
      bestBid,
      bestAsk,
      spread,
      spreadPct,
      liquidityInTightRange: {
        bidSide: bidLiquidity,
        askSide: askLiquidity,
        totalUsd: (bidLiquidity + askLiquidity) * midPrice
      },
      volume24h: 0 // Not available in order_book channel, would need separate sub
    };
  }

  public subscribe(callback: (data: MarketTicker[]) => void) {
    this.subscribers.push(callback);
    // Immediately send current state if available
    if (this.marketTickers.size > 0) {
      callback(Array.from(this.marketTickers.values()));
    }
    return () => {
      this.subscribers = this.subscribers.filter(s => s !== callback);
    };
  }

  private notify() {
    const data = Array.from(this.marketTickers.values());
    this.subscribers.forEach(s => s(data));
  }
}

export const paradexService = new ParadexService();
