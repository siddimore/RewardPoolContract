// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol";

contract ERC20Mock is ERC20PresetMinterPauser {
    constructor(
        string memory name,
        string memory symbol
    ) ERC20PresetMinterPauser(name, symbol) {
        _mint(msg.sender, 4000000 * 10 ** decimals());
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }
}
