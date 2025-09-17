import algosdk from "algosdk";
import { SingleStake } from "./types";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { CrashGameFactory } from "../contract/algorun_contract/CrashGameClient";
import { randomUUID, UUID } from "crypto";
import dotenv from "dotenv";
dotenv.config();

/**
 * Withdraw function - calculates payout based on stake and current multiplier
 */
export async function withdraw(
  address: string,
  stake: SingleStake,
  multiplier: number
): Promise<number> {
  const amount = stake.amount * multiplier;
  const algod = new algosdk.Algodv2(
    "",
    "https://testnet-api.algonode.cloud",
    ""
  );
  const senderPrivateKey = algosdk.mnemonicToSecretKey(
    process.env.SENDER_MNEMONIC || ""
  );
  const receiver = address;

  //transaction params
  const params = await algod.getTransactionParams().do();

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: senderPrivateKey.addr,
    receiver: receiver,
    amount: algosdk.algosToMicroalgos(Math.floor(amount)), //Math.floor(amount), // Amount in microAlgos
    suggestedParams: params,
  });
  const signedTxn = txn.signTxn(senderPrivateKey.sk);
  const response = await algod.sendRawTransaction(signedTxn).do();
  const confirmedTxn = await algosdk.waitForConfirmation(
    algod,
    response.txid,
    4
  );
  console.log(
    `Withdraw - Address: ${address}, Stake: ${stake.amount}, Multiplier: ${multiplier}, Payout: ${amount}`
  );
  return amount;
}

/**
 * Save game result to database
 */
export async function saveToDB(crashAt: number): Promise<void> {
  const gameid = randomUUID();
  const formattedCrashAt = parseFloat(crashAt.toFixed(2));
  console.log(`Saving game to DB - Crashed at: ${formattedCrashAt}`);
  const algorand = AlgorandClient.testNet();
  const gameCreator = await algorand.account.fromMnemonic(
    `${process.env.GAME_CREATOR_MNEMONIC}`
  );
  const factory = algorand.client.getTypedAppFactory(CrashGameFactory, {
    defaultSender: gameCreator.addr,
  });

  const appId = 745912429;

  const { appClient } = factory.getAppClientById({ appId: BigInt(appId) });

  // const {appClient} = await factory.send.create.bare();
  // TODO: Implement actual database save logic
  // const response = await appClient.send.setGameData({ args: { gameid: `${gameid}`, crashAt: `${formattedCrashAt}`, date: `${Date.now()}` } });
  const response = await appClient.send.call({
    method: "setGameData",
    args: [gameid, formattedCrashAt.toString(), Date.now().toString()],
  });
  console.log(response.return);

  // This could be a database insert, API call, etc.

  // Simulate async operation
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/**
 * Calculate current multiplier based on start time, end time, current time, and crash value
 */
export function calculateMultiplier(
  startTime: number,
  endTime: number,
  currentTime: number,
  crashAt: number
): number {
  if (currentTime < startTime) return 1.0;
  if (currentTime >= endTime) return crashAt; // Return actual crash value when crashed

  const elapsed = currentTime - startTime;
  const totalDuration = endTime - startTime;
  const progress = elapsed / totalDuration;

  // Linear progression from 1.00 to crashAt
  return 1.0 + progress * (crashAt - 1.0);
}
