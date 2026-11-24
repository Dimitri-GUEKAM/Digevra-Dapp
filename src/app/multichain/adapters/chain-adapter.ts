import {
  MultiChainNetworkConfig,
  TokenConfig
} from '../models/network';

export interface ChainAdapter {
  isValidAddress(address: string): boolean;
  getNativeBalance(
    network: MultiChainNetworkConfig,
    address: string
  ): Promise<string>;
  getTokenBalance?(
    network: MultiChainNetworkConfig,
    address: string,
    token: TokenConfig
  ): Promise<string>;
}
