import { Move } from "../move";
import { Bot } from "mineflayer";
import { BaseSimulator, Controller, EPhysicsCtx, EntityPhysics, SimulationGoal } from "@nxg-org/mineflayer-physics-util";
import { Vec3 } from "vec3";
import { EntityState, PlayerState } from "@nxg-org/mineflayer-physics-util/dist/physics/states";
import { MovementProvider } from "../../abstract";
import { goals } from "../goals";
import { emptyVec } from "@nxg-org/mineflayer-physics-util/dist/physics/settings";
import * as controls from "../controls";
import { SimMovement } from ".";
import { World } from "../world/WorldInterface";


const sleep = (ms: number) => new Promise<void>((res, rej) => setTimeout(res, ms));


// Keeping this logic temporarily just for testing.
const cardinalVec3s: Vec3[] = [
  // { x: -1, z: 0 }, // West
  // { x: 1, z: 0 }, // East
  // { x: 0, z: -1 }, // North
  // { x: 0, z: 1 }, // South
  new Vec3(-1, 0, 0),
  new Vec3(1, 0, 0),
  new Vec3(0, 0, -1),
  new Vec3(0, 0, 1),
];

const diagonalVec3s: Vec3[] = [
  // { x: -1, z: -1 },
  // { x: -1, z: 1 },
  // { x: 1, z: -1 },
  // { x: 1, z: 1 },
  new Vec3(-1, 0, -1),
  new Vec3(-1, 0, 1),
  new Vec3(1, 0, -1),
  new Vec3(1, 0, 1),
];

const jumpVec3s: Vec3[] = [
  new Vec3(-3, 0, 0),
  new Vec3(-2, 0, 1),
  new Vec3(-2, 0, -1),
  new Vec3(-1, 0, 2),
  new Vec3(-1, 0, -2),
  new Vec3(0, 0, 3),
  new Vec3(0, 0, -3),
  new Vec3(1, 0, 2),
  new Vec3(1, 0, -2),
  new Vec3(2, 0, 1),
  new Vec3(2, 0, -1),
  new Vec3(3, 0, 0),
];

function setState(simCtx: EPhysicsCtx, pos: Vec3, vel: Vec3) {
  simCtx.state.age = 0;
  simCtx.state.pos.set(pos.x, pos.y, pos.z);
  simCtx.state.vel.set(vel.x, vel.y, vel.z);
}

function getStraightAim(x: number, z: number): Controller {
  return (state: EntityState, ticks: number) => {
    const dx = x - state.pos.x;
    const dz = z - state.pos.z;
    state.yaw = Math.atan2(-dx, -dz);
  };
}

function getReached(x: number, y: number, z: number): SimulationGoal {
  return (state: EntityState) => {
    // console.log(Math.abs(x - state.pos.x), Math.abs(z - state.pos.z), y ,state.pos.y, state.onGround)
    return (
      Math.abs(x - state.pos.x) <= 0.3 &&
      Math.abs(z - state.pos.z) <= 0.3 &&
      // Math.abs(y - state.pos.y) < 1 &&
      (state.onGround || state.isInWater)
    );
  };
}


export class IdleMovement extends SimMovement {
  doable(start: Move, dir: Vec3, storage: Move[]): void {}
  performInit = async (thisMove: Move, goal: goals.Goal) => {};
  performPerTick = async (thisMove: Move, tickCount: number, goal: goals.Goal) => {
    return true;
  };
}

export class ForwardMovement extends SimMovement {
  doable(start: Move, dir: Vec3, storage: Move[]): void {
    setState(this.stateCtx, start.exitPos, start.exitVel);
    this.stateCtx.state.clearControlStates();
    this.stateCtx.state.control.set("forward", true);
    this.stateCtx.state.control.set("sprint", true);

    const nextGoal = new Vec3(start.x + dir.x, start.y, start.z + dir.z);
    // console.log(start.entryPos, goal)

    // const smartControls: Controller = (state, ticks) => state.control.set('jump', ticks == 0);

    const stopOnHoriCollision: SimulationGoal = (state) => state.isCollidedHorizontally;
    const stopOnNoVertCollision: SimulationGoal = (state, ticks) => ticks > 0 && !state.isCollidedVertically;
    // const pastGoal: SimulationGoal = (state) => state.pos.xzDistanceTo(goal) < start.entryPos.xzDistanceTo(goal);
    const reach = getReached(nextGoal.x, nextGoal.y, nextGoal.z);

    const state = this.simulateUntil(
      SimMovement.buildAnyGoal(
        reach
        // stopOnHoriCollision,
        // stopOnNoVertCollision,
        // pastGoal
      ),
      () => {},
      getStraightAim(nextGoal.x, nextGoal.z),
      this.stateCtx,
      this.world,
      20
    );

    const diff = state.pos.minus(start.exitPos).norm();
    if (diff === 0) return;
    const cost = Math.round((state.age * 10) / diff);

    if (reach(state, state.age)) {
      storage.push(Move.fromPrevious(cost, start, this, state));
    }
  }

  align = () => {
    return this.bot.entity.onGround;
  };

  shouldCancel = (preMove: boolean, move: Move, tickCount: number): boolean => {
    return this.bot.entity.position.y < move.exitPos.y || tickCount > 30;
  };

  performPerTick = async (move: Move): Promise<boolean> => {
    const pos = this.bot.entity.position;
    console.log(pos, move.exitPos);
    if (pos.minus(move.exitPos).norm() < 0.5 && this.bot.entity.onGround) return true;
    return false;
  };

  performInit = async (move: Move): Promise<void> => {
    console.log("walking", move.hash);
    await this.bot.lookAt(new Vec3(move.exitPos.x, move.exitPos.y, move.exitPos.z), true);

    const dx = move.exitPos.x - this.bot.entity.position.x;
    const dz = move.exitPos.z - this.bot.entity.position.z;
    const wantedYaw = Math.atan2(-dx, -dz);
    this.bot.entity.yaw = wantedYaw;
    this.bot.setControlState("forward", true);
    this.bot.setControlState("sprint", true);
    return;
  };
}

export class ForwardJumpMovement extends SimMovement {
  controlAim(nextPoint: Vec3) {
    const zero = controls.getControllerSmartMovement(nextPoint, true);
    const one = controls.getControllerStrafeAim(nextPoint);
    let aimed = false;
    return (state: EntityState, ticks: number) => {
      if (!aimed) {
        const dx = nextPoint.x - state.pos.x;
        const dz = nextPoint.z - state.pos.z;
        state.yaw = Math.atan2(-dx, -dz);
        aimed = true;
      }

      if (state.isCollidedHorizontally) {
        state.control.set("jump", true);
        state.control.set("forward", false);
        // state.control.set("back", true);
        state.control.set("sprint", false);
      } else {
        if (state.vel.offset(0, -state.vel.y, 0).norm() > 0.15) state.control.set("jump", true);
        // state.control.set("back", false);
        state.control.set("forward", true);
        state.control.set("sprint", true);
      }

      // zero(state, ticks);
      one(state, ticks);
    };
  }

  botAim(bot: Bot, nextMove: Vec3, goal: goals.Goal) {
    const zero = controls.getBotSmartMovement(bot, nextMove, true);
    const one = controls.getBotStrafeAim(bot, nextMove);
    let aimed = false;
    return () => {
      if (!aimed) {
        const dx = nextMove.x - bot.entity.position.x;
        const dz = nextMove.z - bot.entity.position.z;
        bot.entity.yaw = Math.atan2(-dx, -dz);
        aimed = true;
      }

      if ((bot.entity as any).isCollidedHorizontally) {
        bot.setControlState("jump", true);
        bot.setControlState("forward", false);
        // bot.setControlState("back", true);
        bot.setControlState("sprint", false);
      } else {
        // console.log(bot.entity.velocity.offset(0, -bot.entity.velocity.y,0).norm())
        if (bot.entity.velocity.offset(0, -bot.entity.velocity.y, 0).norm() > 0.15) bot.setControlState("jump", true);
        // bot.setControlState("back", false);
        bot.setControlState("forward", true);
        bot.setControlState("sprint", true);
      }
      // zero();
      one();
    };
  }

  // right should be positiive,
  // left should be negative.

  getReached(goal: goals.Goal, nextPos: Vec3, start: Move) {
    const vecGoal = goal.toVec();
    return (state: EntityState, age: number) => {
      // if (!state.isCollidedVertically) return false;
      if (state.pos.minus(nextPos).norm() < 0.3) return true;
      return vecGoal.minus(state.pos).norm() <= vecGoal.minus(nextPos).norm(); //&& state.pos.minus(start.entryPos).norm() < 0.5
    };
  }

  botReach(bot: Bot, move: Move, goal: goals.Goal) {
    const vecGoal = goal.toVec();
    // const vecStart = new Vec3(start.x, start.y, start.z);
    return () => {
      // console.log(bot.entity.position.minus(move.exitPos).norm());
      // if (bot.entity.position.minus(move.exitPos).norm() < 0.2) return true;
      // if (!bot.entity.onGround) return false;
      return vecGoal.minus(bot.entity.position).norm() <= vecGoal.minus(move.exitPos).norm();
    };
  }

  doable(start: Move, dir: Vec3, storage: Move[], goal: goals.Goal): void {
    setState(this.stateCtx, start.exitPos, emptyVec);
    this.stateCtx.state.clearControlStates();

    const nextGoal = new Vec3(start.x + dir.x, start.y + dir.y, start.z + dir.z);
    const stopOnVertCollision: SimulationGoal = (state, ticks) => {
      return state.control.get("jump") && state.isCollidedVertically;
    };
    const reach = this.getReached(goal, start.exitPos, start);

    // console.log(start.exitPos)
    const state = this.simulateUntil(
      SimMovement.buildAnyGoal(stopOnVertCollision),
      () => {},
      this.controlAim(nextGoal),
      this.stateCtx,
      this.world,
      30
    );

    const diff = state.pos.minus(start.exitPos).norm();

    // console.log(state.pos, nextGoal, diff)
    if (diff === 0) return;
    const cost = Math.round((state.age * 10) / diff);

    // if (stopOnHoriCollision(state, state.age)) {
    //   return;
    // }

    if (reach(state, state.age)) {
      // console.log("GI",state.pos, state.isCollidedVertically, cost)
      storage.push(Move.fromPrevious(cost, start, this, state));
    }
  }

  align = (thisMove: Move, tickCount: number, goal: goals.Goal) => {
    return this.bot.entity.onGround;
  };

  shouldCancel = (preMove:boolean, thisMove: Move, tickCount: number, goal: goals.Goal) => {
    return tickCount > 40;
  };

  performPerTick = (move: Move, tickCount: number, goal: goals.Goal): boolean => {
    const botAim = this.botAim(this.bot, move.exitPos, goal);
    const botReach = this.botReach(this.bot, move, goal);
    botAim();

    return botReach();
  };

  performInit = async (move: Move, goal: goals.Goal): Promise<void> => {
    console.log("jumping!", move.hash);
    await this.bot.lookAt(new Vec3(move.exitPos.x, move.exitPos.y, move.exitPos.z), true);

    const dx = move.exitPos.x - this.bot.entity.position.x;
    const dz = move.exitPos.z - this.bot.entity.position.z;
    const wantedYaw = Math.atan2(-dx, -dz);
    this.bot.entity.yaw = wantedYaw;
  };
}

type BuildableMove = new (bot: Bot, world: World) => SimMovement;
export class MovementHandler implements MovementProvider<Move> {
  recognizedMovements: SimMovement[];
  goal!: goals.Goal;
  world: World;

  constructor(private bot: Bot, world: World, recMovement: BuildableMove[]) {
    this.world = world;
    this.recognizedMovements = recMovement.map((m) => new m(bot, this.world));
  }

  sanitize(): boolean {
    return !!this.goal;
  }

  loadGoal(goal: goals.Goal) {
    this.goal = goal;
  }

  getNeighbors(currentMove: Move): Move[] {
    const moves: Move[] = [];

    const straight = new Vec3(this.goal.x - currentMove.x, this.goal.y - currentMove.y, this.goal.z - currentMove.z).normalize();

    for (const newMove of this.recognizedMovements) {
      newMove.doable(currentMove, straight, moves, this.goal);
    }

    for (const dir of cardinalVec3s) {
      for (const newMove of this.recognizedMovements) {
        newMove.doable(currentMove, dir, moves, this.goal);
      }
    }

    for (const dir of diagonalVec3s) {
      for (const newMove of this.recognizedMovements) {
        // if (!(newMove instanceof ForwardJumpMovement))
        newMove.doable(currentMove, dir, moves, this.goal);
      }
    }

    for (const dir of jumpVec3s) {
      for (const newMove of this.recognizedMovements) {
        newMove.doable(currentMove, dir, moves, this.goal);
      }
    }

    return moves;
  }
}