# Porting the Laundromat Discrete Event Simulation to JavaScript

This document outlines how the mathematical logic and simulation behavior from the Python `SimPy` notebook (`M&S(2).ipynb`) was structurally translated into the native browser application (`script.js`).

While the code is not character-for-character identical due to language differences, the **mathematical logic and the simulation behavior are 100% identical.**

## 1. Rebuilding the SimPy Engine (`simpy.Environment`)
In Python, the model relies on `env.run(until=SIM_DURATION)` and `yield env.timeout()` to advance the simulation clock. 
Because JavaScript does not have `SimPy`, a lightweight **Event Queue** engine was built from scratch. 
Instead of pausing execution (like Python generators do), the JavaScript `simStep()` function looks at the `eventQueue` array, finds the next scheduled event in chronological order, advances the internal `simTime` clock to that exact moment, and executes the event logic.

## 2. Recreating SimPy Resources (`simpy.Resource`)
In the notebook, limited resources were defined using `simpy.Resource(env, capacity=...)`. 
In JavaScript, a custom `makeResource()` function replicates this behavior exactly. It tracks the `capacity` of the machines, how many are currently in use (`count`), and maintains a strict First-In, First-Out (FIFO) queue array for customers who are waiting for a machine to free up.

## 3. Translating the Stochastic Math (Randomness)
The Python code utilizes probability distributions to mimic real-life unpredictability:
- `random.expovariate()` for customer inter-arrival times.
- `random.uniform()` for basic machine loading/transfer delays.

Exact JavaScript equivalents for these mathematical functions were written (`randExp()`, `randUniform()`, and `randNormal()`). This ensures that the peak hour rush and the unpredictable cycle durations behave identically to the original research parameters.

## 4. Mapping the 13-Event Customer Journey
In the notebook, a `customer()` function traced 13 distinct sequential events from arrival to departure.
This process was ported into a massive `switch` statement inside `handleEvent()` in `script.js`. For example, when a customer finishes washing (`wash-done`), the script applies the transfer delay (0-5 mins) and immediately schedules a `try-dry` event, forcing them into the dryer queue, strictly following the Python logic.

## 5. Upgrading the Outputs to Visuals
The biggest difference lies in data visualization. 
- The Python notebook appended queue lengths to lists and printed text logs. 
- The JavaScript application takes those exact same data arrays (`tsWQ`, `tsDQ`) and hooks them up to **Chart.js** to draw the data live. 
- Additionally, it takes the real-time status of the resources and uses the HTML5 `<canvas>` (`drawFloor()`) to physically paint the washers and dryers on the screen, allowing users to visually observe the bottleneck forming instead of merely reading text outputs.
