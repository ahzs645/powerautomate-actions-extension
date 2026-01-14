// ConnectorService - Provides connector metadata and tier information
// Uses the connectors database for accurate connector classification

import connectorsData from '../data/connectors.json';

export interface ConnectorInfo {
  name: string;
  displayName: string;
  tier: 'Standard' | 'Premium' | 'Unknown';
  description: string;
  icon: string;
  category: string;
}

export interface TierInfo {
  description: string;
  color: string;
}

export class ConnectorService {
  private connectors: Map<string, ConnectorInfo>;
  private tiers: Map<string, TierInfo>;
  private categories: string[];

  constructor() {
    this.connectors = new Map();
    this.tiers = new Map();
    this.categories = connectorsData.categories;

    // Load connectors
    for (const [id, info] of Object.entries(connectorsData.connectors)) {
      this.connectors.set(id.toLowerCase(), info as ConnectorInfo);
    }

    // Load tiers
    for (const [tier, info] of Object.entries(connectorsData.tiers)) {
      this.tiers.set(tier, info);
    }
  }

  /**
   * Get connector info by connection reference name or API ID
   */
  getConnector(identifier: string): ConnectorInfo | null {
    if (!identifier) return null;

    // Normalize the identifier
    const normalized = identifier.toLowerCase();

    // Direct lookup
    if (this.connectors.has(normalized)) {
      return this.connectors.get(normalized)!;
    }

    // Try to extract connector name from API path
    // e.g., "/providers/Microsoft.PowerApps/apis/shared_sharepointonline"
    const apiMatch = normalized.match(/shared_(\w+)/);
    if (apiMatch) {
      const searchKey = `shared_${apiMatch[1]}`;
      if (this.connectors.has(searchKey)) {
        return this.connectors.get(searchKey)!;
      }
    }

    // Try partial match
    const keys = Array.from(this.connectors.keys());
    for (const key of keys) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return this.connectors.get(key)!;
      }
    }

    return null;
  }

  /**
   * Get connector tier (Standard, Premium, Unknown)
   */
  getConnectorTier(identifier: string): 'Standard' | 'Premium' | 'Unknown' {
    const connector = this.getConnector(identifier);
    return connector?.tier || 'Unknown';
  }

  /**
   * Get tier info
   */
  getTierInfo(tier: string): TierInfo | null {
    return this.tiers.get(tier) || null;
  }

  /**
   * Get tier color
   */
  getTierColor(tier: string): string {
    const info = this.tiers.get(tier);
    if (info) return info.color;

    // Default colors
    switch (tier) {
      case 'Standard':
        return '#107c10';
      case 'Premium':
        return '#8764b8';
      default:
        return '#605e5c';
    }
  }

  /**
   * Check if a connector is premium
   */
  isPremium(identifier: string): boolean {
    return this.getConnectorTier(identifier) === 'Premium';
  }

  /**
   * Get all connector categories
   */
  getCategories(): string[] {
    return [...this.categories];
  }

  /**
   * Get all connectors in a category
   */
  getConnectorsByCategory(category: string): ConnectorInfo[] {
    const values = Array.from(this.connectors.values());
    return values.filter((info) => info.category === category);
  }

  /**
   * Get all premium connectors
   */
  getPremiumConnectors(): ConnectorInfo[] {
    const values = Array.from(this.connectors.values());
    return values.filter((info) => info.tier === 'Premium');
  }

  /**
   * Get all standard connectors
   */
  getStandardConnectors(): ConnectorInfo[] {
    const values = Array.from(this.connectors.values());
    return values.filter((info) => info.tier === 'Standard');
  }

  /**
   * Search connectors by name
   */
  searchConnectors(query: string): ConnectorInfo[] {
    if (!query) return [];

    const lowerQuery = query.toLowerCase();
    const values = Array.from(this.connectors.values());

    return values.filter(
      (info) =>
        info.name.toLowerCase().includes(lowerQuery) ||
        info.displayName.toLowerCase().includes(lowerQuery) ||
        info.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get connector count
   */
  getConnectorCount(): { total: number; standard: number; premium: number } {
    const values = Array.from(this.connectors.values());
    const standard = values.filter((info) => info.tier === 'Standard').length;
    const premium = values.filter((info) => info.tier === 'Premium').length;

    return {
      total: this.connectors.size,
      standard,
      premium,
    };
  }

  /**
   * Get display name for a connector
   */
  getDisplayName(identifier: string): string {
    const connector = this.getConnector(identifier);
    if (connector) return connector.displayName;

    // Extract name from identifier if not found
    const match = identifier.match(/shared_(\w+)/);
    if (match) {
      // Convert snake_case to Title Case
      return match[1]
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    return identifier;
  }

  /**
   * Get icon name for a connector
   */
  getIcon(identifier: string): string {
    const connector = this.getConnector(identifier);
    return connector?.icon || 'PlugConnected';
  }
}

// Singleton instance
let connectorServiceInstance: ConnectorService | null = null;

export function getConnectorService(): ConnectorService {
  if (!connectorServiceInstance) {
    connectorServiceInstance = new ConnectorService();
  }
  return connectorServiceInstance;
}

export default ConnectorService;
