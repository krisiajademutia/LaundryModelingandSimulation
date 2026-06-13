# Python SimPy Code Explanation: M&S(2).ipynb

This document provides a cell-by-cell, detailed explanation of the original Python code found in your Jupyter Notebook. It explains the purpose of each block of code and how it contributes to the overall Discrete Event Simulation.

---

### Cell 1: Environment Setup
```python
!pip install simpy
```
**Purpose:** Installs the `simpy` library into the Jupyter environment. SimPy is the core process-based discrete-event simulation framework used to model the active components (customers) and limited resources (machines) of the laundromat.

---

### Cell 2: Library Imports
```python
import simpy
import random
import numpy as np
import matplotlib.pyplot as plt
```
**Purpose:** Imports the necessary Python modules.
- `simpy`: The simulation engine.
- `random`: Used to generate stochastic (random) numbers for arrival times and cycle delays.
- `numpy`: Used for mathematical array operations (if needed for advanced stats).
- `matplotlib.pyplot`: Used to draw the charts and histograms at the end of the simulation.

---

### Cell 3: Constants & Parameters
```python
NUM_WASHERS = 6
NUM_DRYERS = 8
NUM_SOAP_MACHINES = 2
NUM_FOLD_TABLES = 3
SIM_DURATION = 720 # 12 hours from 8 AM to 8 PM
...
```
**Purpose:** Defines the "hardcoded" physical parameters of the laundromat. 
- It sets the capacity for the resources (6 washers, 8 dryers).
- It defines the simulation duration (720 minutes = 12 hours).
- It establishes the mathematical parameters for the random distributions (e.g., mean drying time, standard deviations, arrival rates for peak vs. normal hours).

---

### Cell 4: Global Data Collection Arrays
```python
wash_wait_times = [] 
dry_wait_times = []
total_times = []
time_log = []
wash_queue_log = []
dry_queue_log = []
customers_arrived = 0
customers_served = 0
```
**Purpose:** Initializes empty lists and counters. These act as the "memory" of the simulation. As customers flow through the system, the simulation will continuously append their wait times and the lengths of the queues into these lists so they can be analyzed and charted at the end.

---

### Cell 5: Time Formatting Helper
```python
def to_clock(t):
    total_minutes = int(480 + t)
    ...
```
**Purpose:** A helper function that converts the raw simulation time (which counts from `0` to `720` minutes) into a human-readable 24-hour clock format (e.g., `08:00`, `13:45`). This is strictly for making the printed text logs and chart X-axis labels easy to read.

---

### Cell 6: The Customer Process (The Core Logic)
```python
def customer(env, name, n_baskets, soap_machine, washer, dryer, fold_table):
    ...
```
**Purpose:** This massive function defines the "Lifecycle" of a single customer. It utilizes Python `yield` statements, which tell the simulation engine to "pause" this specific customer until a condition is met, allowing other customers to act in the meantime.
- **`yield soap_machine.request()`:** The customer gets in line for the soap machine. They pause here until a machine is free.
- **`yield env.timeout(random.uniform(...))`:** Simulates the time it takes to buy soap.
- **`yield washer.request()`:** The customer gets in the washer queue. The code measures the time they entered the queue and the time the request is granted to calculate `wash_wait_times`.
- **`yield env.timeout(WASH_TIME)`:** Simulates the 35-minute wash cycle.
- **Transfer Delay:** A random `env.timeout` is yielded to simulate the customer stepping away and leaving wet clothes blocking the machine.
- **`yield dryer.request()`:** The customer enters the dryer queue (the bottleneck). Wait times are aggressively tracked here.
- **Folding & Departure:** Finally, the customer requests a folding table, folds their clothes, and departs, incrementing the `customers_served` counter.

---

### Cell 7: The Customer Generator (Arrival Process)
```python
def customer_generator(env, soap_machine, washer, dryer, fold_table):
    ...
```
**Purpose:** This function is responsible for continuously spawning new customers into the laundromat over the 12-hour day. 
- It checks the current time (`env.now`) to see if it is a "Peak Hour".
- It uses `random.expovariate(arrival_rate)` to randomly calculate how many minutes until the next customer walks through the door.
- It `yields` a timeout for that duration, and then triggers `env.process(customer(...))` to create a new customer entity.

---

### Cell 8: Queue Monitor (Data Tracker)
```python
def queue_monitor(env, washer, dryer):
    ...
```
**Purpose:** This is a background process that acts like a security camera taking a snapshot every 1 minute.
- It runs a `while True` loop.
- It appends the current time (`env.now`), the length of the washer queue (`len(washer.queue)`), and the length of the dryer queue (`len(dryer.queue)`) to the global tracking arrays.
- It `yields env.timeout(1)` to sleep for exactly 1 minute before taking the next snapshot.

---

### Cell 9: Simulation Execution
```python
env = simpy.Environment()
soap_machine = simpy.Resource(env, capacity=NUM_SOAP_MACHINES)
...
env.process(customer_generator(...))
env.process(queue_monitor(...))
env.run(until=SIM_DURATION)
```
**Purpose:** This is where the simulation actually starts.
- It creates the "World" (`simpy.Environment()`).
- It physically instantiates the limited resources with their capacities (`simpy.Resource`).
- It boots up the generator and monitor processes.
- `env.run(until=SIM_DURATION)` tells the engine to run the simulation loop at lightning speed until 720 virtual minutes have passed.

---

### Cell 10: Statistical Results Calculation
```python
if len(dry_wait_times) > 0:
    avg_dry_wait = sum(dry_wait_times) / len(dry_wait_times)
...
print(f"  Avg wait for dryer  : {avg_dry_wait:.2f} min  ← BOTTLENECK METRIC")
...
```
**Purpose:** After the simulation finishes, this cell calculates the mathematical averages, maximums, and throughput percentages using the data collected in the global arrays from Cell 4. It prints out a clean text summary proving the existence of the dryer bottleneck.

---

### Cell 11: Data Visualization (Matplotlib Charts)
```python
fig, axes = plt.subplots(1, 2, figsize=(14, 5))
...
ax1.plot(time_log, dry_queue_log,  color="#E24B4A", ...)
...
```
**Purpose:** Uses the `matplotlib` library to draw two charts:
1. **A Line Chart** plotting the washer and dryer queue lengths over time, highlighting the peak hours in yellow.
2. **A Histogram** showing the distribution of customer wait times.
It then saves this image as `chart_baseline.png`.

---

### Cell 12: What-If Scenario (More Dryers)
```python
env2 = simpy.Environment()
dryer2 = simpy.Resource(env2, capacity=12) # MORE dryers
...
env2.run(until=SIM_DURATION)
```
**Purpose:** This cell executes a "What-If" analysis to test if buying more dryers solves the bottleneck. It completely resets the tracking arrays, creates a brand new simulation environment (`env2`), but this time it explicitly sets the dryer capacity to `12` instead of `8`. It runs the simulation again to compare the new wait times against the baseline.
