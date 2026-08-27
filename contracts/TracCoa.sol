// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Platform-custodial COA contract: every token is minted to, and stays
// permanently held by, the TRACStudio platform wallet (the contract owner).
// Collectors never hold a wallet or receive the NFT directly - ownership
// changes are tracked off-chain (coa_ownership_history) and anchored here as
// a provenance event, not an actual ERC721 transfer. Deployed manually via
// Remix (see contracts/README or the Polygon integration plan) - not part of
// this repo's build/deploy pipeline since there is none.
contract TracCoa is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId = 1;

    event ProvenanceRecorded(uint256 indexed tokenId, string note, uint256 timestamp);

    constructor(address initialOwner)
        ERC721("TRAC Certificate of Authenticity", "TRACOA")
        Ownable(initialOwner)
    {}

    function mintCoa(string memory metadataURI) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, metadataURI);
        return tokenId;
    }

    // Reverts if tokenId was never minted (ownerOf reverts on a nonexistent
    // token) - that's the only existence check needed here, since this never
    // moves ownership.
    function recordTransfer(uint256 tokenId, string memory note) external onlyOwner {
        ownerOf(tokenId);
        emit ProvenanceRecorded(tokenId, note, block.timestamp);
    }
}
