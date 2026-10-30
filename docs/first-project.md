# A first project

This guide goes from a JML contract in a Java project to a closed proof. The steps apply to
any project.

## 1. A method with a contract

KeY proves that a method satisfies its JML contract. Write the contract in a comment that
starts with `@`, directly above the method:

```java
package com.example.core;

public class Account {

    private int balance;

    /*@ public normal_behavior
      @  requires amount > 0;
      @  requires balance + amount <= Integer.MAX_VALUE;
      @  ensures balance == \old(balance) + amount;
      @  assignable balance;
      @*/
    public void deposit(int amount) {
        balance += amount;
    }
}
```

`requires` states the precondition, which the caller must establish. `ensures` states the
postcondition, which holds when the method returns. `assignable` lists the locations the
method may change. Methods without a contract have no proof obligations and do not appear in
the KeY views.

## 2. Define a context

A **context** is a source directory that KeY loads, with its classpath. It need not cover
the whole project.

Run **KeY: Edit Contexts** from the command palette, choose **Add a context**, and enter:

- an **id** of your choice, for example `core`
- the **Java source** directory that contains the packages, for example
  `core/src/main/java`
- a **classpath**, **bootclasspath** and **includes** only if you need them

The contexts are stored in `.key/settings.json` in the project. Commit this file. **KeY:
Validate Configuration** checks the paths without loading them into KeY and reports invalid
entries.

!!! tip
    `.key/settings.json` can also be edited directly. **KeY: Open Configuration File** opens
    it and creates a template if the project has none.

## 3. Verify

Put the cursor in `deposit`, right-click and choose **Verify with KeY**, or click **Verify
with KeY** above the method. The same action is on each row of the **Proof Obligations**
pane, and **KeY: Verify Everything** proves the whole project.

A progress notification shows the run, which can be cancelled. When the run ends, a
notification reports how many obligations were proved, and the gutter mark beside `deposit`
changes to a green check mark.

## 4. Check the results

- **Verification** shows the status of each obligation, the number of proof nodes and
  branches, and the time the proof took.
- **Proof Obligations** lists all proof obligations of the project with KeY's status icons.
- The proof is saved as `proofs/core/com/example/core/….proof`, a text file. Commit it, so
  that others can replay the proof instead of proving it again.

## 5. Change the code

Change the method so that it no longer satisfies the contract, and save:

```java
balance += amount + 1;
```

**Verify on save** is on by default. On saving, the saved proof is replayed against the
changed sources. The replay does not close the proof, so KeY attempts the proof again, which
stays open. The notification names the obligation, and the gutter mark changes to a red
cross. Restore the method and save again to close the proof.

## 6. Proofs that use other contracts

A method call is verified against the contract of the called method, not against its body.
As long as the called method's contract has no closed proof, KeY reports the caller's proof
as `CLOSED_BUT_LEMMAS_LEFT`, and the gutter shows an orange check mark in brackets.

Choose **Show Dependencies** on the row to list the contracts the proof uses in the
**Dependencies** pane, then click **Verify Dependencies** in the pane's title bar to prove
them. When the last of them is proved, the mark changes to a green check mark.

## Files

| | |
|---|---|
| `.key/settings.json` | the contexts and the proof options; commit it |
| `proofs/` | the saved proofs; commit them |
| `proofs/.trash/` | proofs replaced by a new run; see the trash setting in [Settings](settings.md) |
| `.key/tool/` | settings, logs and caches of the KeY instance the extension starts; do not commit it |
