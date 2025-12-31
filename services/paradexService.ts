import { MarketTicker, OrderLevel } from '../types';

// Configuration
// Using the exact production URL found in Paradex docs
const PARADEX_WS_URL = 'wss://ws.api.prod.paradex.trade/v1';
const TARGET_SPREAD_THRESHOLD = 0.00001; // 0.001% target

// DEBUG MODE: ONLY BTC
const TARGET_SYMBOL = 'BTC-USD-PERP';

interface WsMessage {
  jsonrpc: string;
  method: string;
  params?: {
    channel: string;
    data: any;
  };
}

type RawLevel = [string, string];

export type ConnectionStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

class ParadexService {
  private ws: WebSocket | null = null;
  private subscribers: ((data: MarketTicker[]) => void)[] = [];
  private statusSubscribers: ((status: ConnectionStatus) => void)[] = [];
  private localOrderBook: { bids: Map<number, number>; asks: Map<number, number> } = { bids: new Map(), asks: new Map() };
  private currentTicker: MarketTicker | null = null;
  private connectionStatus: ConnectionStatus = 'DISCONNECTED';
  private reconnectTimer: any = null;

  constructor() {
    this.connect();
  }

  private updateStatus(status: ConnectionStatus) {
    console.log(`[ParadexService] Status changed: ${this.connectionStatus} -> ${status}`);
    this.connectionStatus = status;
    this.statusSubscribers.forEach(cb => cb(status));
  }

  private connect() {
    if (this.ws) {
      this.ws.close();
    }

    this.updateStatus('CONNECTING');
    console.log(`[ParadexService] Attempting connection to ${PARADEX_WS_URL}`);

    try {
      this.ws = new WebSocket(PARADEX_WS_URL);

      this.ws.onopen = () => {
        console.log('[ParadexService] WebSocket OPEN. Sending subscription...');
        this.updateStatus('CONNECTED');
        this.subscribeToBTC();
      };

      this.ws.onmessage = (event) => {
        // Uncomment this line if you want to see every raw message in console
        // console.log('[ParadexService] RX:', event.data); 
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          console.error('[ParadexService] Parse error', e);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[ParadexService] WebSocket CLOSED. Code: ${event.code}, Reason: ${event.reason}`);
        this.updateStatus('DISCONNECTED');
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[ParadexService] WebSocket ERROR', err);
        this.updateStatus('ERROR');
        // Do not close manually here, let onclose handle it
      };

    } catch (e) {
      console.error('[ParadexService] Critical connection error', e);
      this.updateStatus('ERROR');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    console.log('[ParadexService] Reconnecting in 5s...');
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, 5000);
  }

  private subscribeToBTC() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Reset local book on new subscription
    this.localOrderBook = { bids: new Map(), asks: new Map() };

    const payload = {
      jsonrpc: "2.0",
      method: "subscribe",
      params: {
        channel: "order_book",
        market: TARGET_SYMBOL
      },
      id: 1
    };

    console.log('[ParadexService] Sending payload:', JSON.stringify(payload));
    this.ws.send(JSON.stringify(payload));
  }

  private handleMessage(msg: WsMessage) {
    // 1. Handle Snapshot (first message) or Update
    if (msg.method === 'subscription_update' && msg.params?.channel === 'order_book') {
      const { market, bids, asks } = msg.params.data;
      if (market === TARGET_SYMBOL) {
        this.processOrderBookUpdate(bids, asks);
      }
    } 
    // 2. Handle Subscription confirmation (id: 1)
    else if ((msg as any).id === 1 && (msg as any).result) {
      console.log('[ParadexService] Subscription Confirmed!');
    }
  }

  private processOrderBookUpdate(rawBids: RawLevel[], rawAsks: RawLevel[]) {
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

    updateLevels(this.localOrderBook.bids, rawBids || []);
    updateLevels(this.localOrderBook.asks, rawAsks || []);

    this.calculateMetrics();
  }

  private calculateMetrics() {
    // Sort Bids (Desc) and Asks (Asc)
    const bids: OrderLevel[] = Array.from(this.localOrderBook.bids.entries())
      .map(([price, size]) => ({ price, size }))
      .sort((a, b) => b.price - a.price);

    const asks: OrderLevel[] = Array.from(this.localOrderBook.asks.entries())
      .map(([price, size]) => ({ price, size }))
      .sort((a, b) => a.price - b.price);

    if (bids.length === 0 || asks.length === 0) return;

    const bestBid = bids[0].price;
    const bestAsk = asks[0].price;
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;
    const spreadPct = spread / bestBid;

    // Liquidity Calculation
    const bidCutoff = bestBid * (1 - TARGET_SPREAD_THRESHOLD);
    const askCutoff = bestAsk * (1 + TARGET_SPREAD_THRESHOLD);

    let bidLiquidity = 0;
    let askLiquidity = 0;

    for (const level of bids) {
      if (level.price >= bidCutoff) bidLiquidity += level.size;
      else break;
    }

    for (const level of asks) {
      if (level.price <= askCutoff) askLiquidity += level.size;
      else break;
    }

    this.currentTicker = {
      symbol: TARGET_SYMBOL,
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

    this.notify();
  }

  public subscribe(callback: (data: MarketTicker[]) => void) {
    this.subscribers.push(callback);
    if (this.currentTicker) {
      callback([this.currentTicker]);
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
    if (this.currentTicker) {
      const data = [this.currentTicker];
      this.subscribers.forEach(s => s(data));
    }
  }
}

export const paradexService = new ParadexService();