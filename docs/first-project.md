# A first project

This walks from an ordinary Java project to a closed proof. It takes a few minutes, and
nothing in it is specific to the example.

## 1. A method with a contract

KeY proves what a JML contract states. Write one above a method, in a comment that starts
with `@`:

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

`requires` is what the caller has to establish, `ensures` what the method promises, and
`assignable` what it may change. A method with no contract has nothing to prove and does not
appear in the KeY views.

## 2. Tell KeY which sources to read

KeY reads a source directory of its own, which need not be the whole project. That is called
a **context**.

Run **KeY: Edit Contexts** from the command palette, choose **Add a context**, and give:

- an **id** of your choosing, for example `core`
- the **Java source** directory holding the packages, for example `core/src/main/java`
- a **classpath**, **bootclasspath** and **includes** if you need them; skip them to start

What you entered is written to `.key/settings.json` in the project, which is meant to be
committed with it. **KeY: Validate Configuration** checks the paths against the rules KeY
imposes, and reports what it would refuse, without loading anything.

!!! tip
    `.key/settings.json` is plain JSON and can be edited by hand:
    **KeY: Open Configuration File** opens it, and creates a starting point when the project
    has none.

## 3. Verify

Three ways, all the same work:

- put the cursor in `deposit`, right-click, **Verify with KeY**
- open the **KeY** view in the activity bar, find the method under **Proof Obligations**,
  and press the play button on its row
- run **KeY: Verify Everything** to prove the whole project

A progress notification appears, and can be stopped. When the run ends, the notification
says how many obligations were proved, and the gutter mark beside `deposit` turns into a
green check.

## 4. Look at what happened

- **Verification** lists what each attempt measured: the state, the number of proof nodes
  and branches, and how long it took.
- **Proof Obligations** lists everything the project can be asked to prove, with KeY's own
  status icon per row.
- The proof itself is written to `proofs/core/com/example/core/…​.proof`. It is a text file,
  and committing it is what lets a colleague, or a later you, replay the proof instead of
  making it again.

## 5. Change the code and watch

Edit the method so it no longer satisfies the contract, and save:

```java
balance += amount + 1;
```

**Verify on save** is on by default. The saved proof is replayed against the new sources,
does not close any more, and is attempted again; the notification says what broke and the
gutter mark turns into a red cross. Put the method back and save again to see it close.

## 6. Proofs that rest on other proofs

A method that calls another is proved against the *contract* of the one it calls, not its
body. Until that other contract has a closed proof of its own, KeY calls the first proof
**closed but for lemmas**, and the gutter shows an orange check in brackets.

Use **Show Dependencies** on such a row to fill the Dependencies pane with what it rests on,
then **Verify Dependencies** in that pane's title to prove those. When the last one closes,
the mark turns green by itself.

## Where things live

| | |
|---|---|
| `.key/settings.json` | the contexts and the proof options; commit it |
| `proofs/` | the saved proofs; commit them |
| `proofs/.trash/` | proofs a rerun replaced; see the trash policy in [Settings](settings.md) |
| `.key/tool/` | the KeY the extension starts keeps its settings, logs and caches here; do not commit it |
