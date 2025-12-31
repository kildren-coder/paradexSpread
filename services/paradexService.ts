import { MarketTicker, OrderLevel } from '../types';

// Configuration
const PARADEX_WS_URL = 'wss://ws.api.prod.paradex.trade/v1';
const PARADEX_API_URL = 'https://api.prod.paradex.trade/v1/markets';
const TARGET_SPREAD_THRESHOLD = 0.00001; // 0.001% target
const SEND_DELAY_MS = 50; // Delay between WS messages to prevent rate limiting

// Default symbols to ensure app works even if API fetch fails
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

export type ConnectionStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

class ParadexService {
  private ws: WebSocket | null = null;
  private subscribers: ((data: MarketTicker[]) => void)[] = [];
  private statusSubscribers: ((status: ConnectionStatus) => void)[] = [];
  private localOrderBooks: Map<string, { bids: Map<number, number>; asks: Map<number, number> }> = new Map();
  private marketTickers: Map<string, MarketTicker> = new Map();
  private symbols: string[] = DEFAULT_SYMBOLS;
  private reconnectTimer: any = null;
  private connectionStatus: ConnectionStatus = 'DISCONNECTED';
  
  // Message Queue for throttling
  private messageQueue: string[] = [];
  private isProcessingQueue: boolean = false;
  private messageIdCounter: number = 0;

  constructor() {
    this.init();
  }

  private init() {
    // 1. Start connection IMMEDIATELY with default symbols.
    this.connect();
    // 2. Fetch full market list in background
    this.fetchMarkets();
  }

  private async fetchMarkets() {
    try {
      console.log('Fetching markets from Paradex API...');
      const response = await fetch(PARADEX_API_URL);
      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }
      const json = await response.json();
      
      // Filter for active PERP markets
      if (json.results && Array.isArray(json.results)) {
        const newSymbols = json.results
          .filter((m: any) => m.symbol.endsWith('-PERP'))
          .map((m: any) => m.symbol)
          .slice(0, 40); // Limit to top 40 to be safe with bandwidth

        if (newSymbols.length > 0) {
          console.log(`Fetched ${newSymbols.length} markets.`);
          this.symbols = newSymbols;
          // Subscribe to new symbols if connected
          if (this.connectionStatus === 'CONNECTED') {
            this.subscribeToMarkets();
          }
        }
      }
    } catch (e) {
      console.warn('Failed to fetch markets list, keeping defaults.', e);
    }
  }

  private updateStatus(status: ConnectionStatus) {
    if (this.connectionStatus !== status) {
      this.connectionStatus = status;
      this.statusSubscribers.forEach(cb => cb(status));
    }
  }

  private connect() {
    if (this.connectionStatus === 'CONNECTED' || this.connectionStatus === 'CONNECTING') return;
    
    // Cleanup existing
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageQueue = []; // Clear queue on reconnect
    this.isProcessingQueue = false;

    this.updateStatus('CONNECTING');
    console.log(`Connecting to ${PARADEX_WS_URL}...`);

    try {
      this.ws = new WebSocket(PARADEX_WS_URL);

      this.ws.onopen = () => {
        console.log('Paradex WS Connected');
        this.updateStatus('CONNECTED');
        this.subscribeToMarkets();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          // ignore parse errors
        }
      };

      this.ws.onclose = (event) => {
        console.log(`Paradex WS closed (Code: ${event.code}, Reason: ${event.reason})`);
        this.updateStatus('DISCONNECTED');
        this.ws = null;
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('Paradex WS error', err);
        this.updateStatus('ERROR');
      };
    } catch (e) {
      console.error('Failed to create WebSocket', e);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      console.log('Attempting reconnect...');
      this.connect();
    }, 5000); // Increased to 5s to be nicer to the server
  }

  private subscribeToMarkets() {
    if (this.connectionStatus !== 'CONNECTED') return;

    console.log(`Queueing subscriptions for ${this.symbols.length} markets...`);
    
    this.symbols.forEach(symbol => {
      if (!this.localOrderBooks.has(symbol)) {
        this.localOrderBooks.set(symbol, { bids: new Map(), asks: new Map() });
      }

      this.messageIdCounter++;
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        method: "subscribe",
        params: {
          channel: "order_book",
          market: symbol
        },
        id: this.messageIdCounter
      });
      
      this.queueMessage(payload);
    });
  }

  // --- Message Queue Logic to prevent Rate Limiting ---
  private queueMessage(message: string) {
    this.messageQueue.push(message);
    this.processQueue();
  }

  private processQueue() {
    if (this.isProcessingQueue || this.messageQueue.length === 0) return;
    
    this.isProcessingQueue = true;
    
    const sendNext = () => {
      if (this.messageQueue.length === 0 || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.isProcessingQueue = false;
        return;
      }

      const msg = this.messageQueue.shift();
      if (msg) {
        try {
          this.ws.send(msg);
        } catch (e) {
          console.error("Failed to send WS message", e);
        }
      }

      // Schedule next send
      setTimeout(sendNext, SEND_DELAY_MS);
    };

    sendNext();
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

    // Optimization: Only recalculate/notify if it's a "Top of Book" change or large update?
    // For now, we do it every time, but debouncing could be added here if UI lags.

    const sortedBids: OrderLevel[] = Array.from(book.bids.entries())
      .map(([price, size]) => ({ price, size }))
      .sort((a, b) => b.price - a.price);

    const sortedAsks: OrderLevel[] = Array.from(book.asks.entries())
      .map(([price, size]) => ({ price, size }))
      .sort((a, b) => a.price - b.price);

    if (sortedBids.length > 0 && sortedAsks.length > 0) {
      const ticker = this.calculateMetrics(symbol, sortedBids, sortedAsks);
      this.marketTickers.set(symbol, ticker);
      this.notify();
    }
  }

  private calculateMetrics(symbol: string, bids: OrderLevel[], asks: OrderLevel[]): MarketTicker {
    const bestBid = bids[0].price;
    const bestAsk = asks[0].price;
    const midPrice = (bestBid + bestAsk) / 2;
    
    const spread = bestAsk - bestBid;
    const spreadPct = spread / bestBid;

    const bidCutoff = bestBid * (1 - TARGET_SPREAD_THRESHOLD);
    const askCutoff = bestAsk * (1 + TARGET_SPREAD_THRESHOLD);

    let bidLiquidity = 0;
    let askLiquidity = 0;

    for (const level of bids) {
      if (level.price >= bidCutoff) {
        bidLiquidity += level.size;
      } else {
        break;
      }
    }

    for (const level of asks) {
      if (level.price <= askCutoff) {
        askLiquidity += level.size;
      } else {
        break;
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
      volume24h: 0 
    };
  }

  public subscribe(callback: (data: MarketTicker[]) => void) {
    this.subscribers.push(callback);
    if (this.marketTickers.size > 0) {
      callback(Array.from(this.marketTickers.values()));
    }
    return () => {
      this.subscribers = this.subscribers.filter(s => s !== callback);
    };
  }

  public subscribeStatus(callback: (status: ConnectionStatus) => void) {
    this.statusSubscribers.push(callback);
    callback(this.connectionStatus);
    return () => {
      this.statusSubscribers = this.statusSubscribers.filter(s => s !== callback);
    };
  }

  private notify() {
    const data = Array.from(this.marketTickers.values());
    this.subscribers.forEach(s => s(data));
  }
}

export const paradexService = new ParadexService();