export interface OrderLevel {
  price: number;
  size: number;
}

export interface OrderBook {
  bids: OrderLevel[];
  asks: OrderLevel[];
  timestamp: number;
}

export interface MarketTicker {
  symbol: string;
  price: number;
  bestBid: number;
  bestAsk: number;
  spread: number; // Absolute difference
  spreadPct: number; // Percentage
  liquidityInTightRange: {
    bidSide: number; // Volume within range on bid side
    askSide: number; // Volume within range on ask side
    totalUsd: number; // Approximate USD value
  };
  volume24h: number;
}

export enum SpreadStatus {
  ULTRA_TIGHT = 'ULTRA_TIGHT', // < 0.001%
  TIGHT = 'TIGHT',       // < 0.01%
  NORMAL = 'NORMAL',
  WIDE = 'WIDE'
}
