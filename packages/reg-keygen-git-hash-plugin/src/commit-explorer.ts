import { GitCmdClient } from "./git-cmd-client";

export type CommitNode = string[];

export class CommitExplorer {

  private _gitCmdClient = new GitCmdClient();
  private _commitNodes: CommitNode[];
  private _branchName: string;
  private _branchNameCache: { [hash: string]: string[] } = {};

  /*
   * e.g. return `[["a38df15", "8e1ac3a"], ["8e1ac3a", "7ba8507"]]`.
   *      The first element of node means commit hash, rest elements means parent commit hashes.
  */
  getCommitNodes(): CommitNode[] {
    return this._gitCmdClient.logGraph()
      .split("\n")
      .map((hashes: string) => (
        hashes
          .replace(/\*|\/|\||\\|_|/g, "")
          .split(" ")
          .filter(hash => !!hash)
      ))
      .filter((hashes: CommitNode) => hashes.length);
  }

  /*
   * e.g. return `master`.
  */
  getCurrentBranchName(): string {
    const currentName = this._gitCmdClient.currentName().replace("\n", "");
    if (currentName.startsWith("(HEAD detached") ||
      currentName.startsWith("(no branch") ||
      currentName.startsWith("(detached from") ||
      (currentName.startsWith("[") && currentName.indexOf("detached") !== -1)) {
      throw new Error("Can't detect branch name because HEAD is on detached commit node.");
    }
    return currentName;
  }

  /*
   * e.g. return `ede92258d154f1ba1e88dc109a83b9ba143d561e`.
  */
  getCurrentCommitHash(): string {
    const currentName = this._branchName;
    if (!currentName || !currentName.length) {
      throw new Error("Fail to detect the current branch.");
    }
    return this._gitCmdClient.revParse(currentName).replace("\n", "");
  }

  // getParentHashes(log: string): string[] {
  //   return log.split("\n")
  //     .filter(l => !!l.length)
  //     .map((log: string) => log.split(" ")[0]);
  // }

  // findChildren(hash: string): CommitNode[] {
  //   return this._commitNodes
  //     .filter(([_, ...parent]) => !!parent.find(h => h === hash));
  // }

  /*
   * e.g. return `["a38df15", "8e1ac3a"]`.
  */
  findParentNode(parentHash: string): CommitNode | undefined {
    return this._commitNodes
      .find(([hash]: string[]) => hash === parentHash);
  }

  /*
   * Return branch name including target hash.
   * e.g. `["master", "feat-x"]`.
  */
  getBranchNames(hash: string): string[] {
    if (this._branchNameCache[hash]) return this._branchNameCache[hash];
    const names = this._gitCmdClient
      .containedBranches(hash)
      .split("\n")
      .filter(h => !!h)
      .map(branch => branch.replace("*", "").trim());
    this._branchNameCache[hash] = names;
    return names;
  }

  /*
   * NOTE: Check if it is a branch hash
   *
   * If there is more than one hash of a child that satisfies all of the following, it is regarded as a branch hash.
   * 
   * 1. Whether the hash is included in the current branch.
   * 2. Child's branch number is larger than parent's branch number.
   * 
  */
  /*
  isBranchHash(hash: string, first: string): boolean {
    const children = this.findChildren(hash);
    if (!children.length) return false;
    const branchNumOnTargetHash = this.getBranchNames(hash).length;
    const mergedHashes = this.getParentHashes(this._gitCmdClient.logMerges());
    return children.some(([childHash]) => {
      const branches = this.getBranchNames(childHash);
      const hasCurrentBranch = branches.includes(this._branchName);
      if (childHash === "9fc8c13") {
        console.log(branches);
        console.log(childHash);
        console.log(children);
        console.log(hasCurrentBranch);
        console.log("a")
        console.log((branchNumOnTargetHash > branches.length))
        console.log((mergedHashes.includes(childHash) && children.length > 1))
        console.log(children.length)
        console.log(branchNumOnTargetHash);
        console.log(children)
        console.log(branches)
        console.log(children.length <= branchNumOnTargetHash)
        console.log("--------------------------")
      }
      return hasCurrentBranch &&
        (branchNumOnTargetHash > branches.length) &&
        (((mergedHashes.includes(childHash)))
          ? children.length < branchNumOnTargetHash
          : true);
    });
  }
  */

  getBranchHash(candidateHashes: string[]): string | undefined {
    const branches = this._gitCmdClient
      .branches()
      .split("\n")
      .map(b => b.replace(/^\*/, "").trim().split(" ")[0])
      .filter(b => !!b || b === this._branchName);
    // console.log(branches)
    const branch = branches.map(b => {
      const hash = this._gitCmdClient.logBetweenOldest(b, this._branchName).split(" ")[0];
      console.log("hash", hash)
      const time = hash ? new Date(this._gitCmdClient.logTime(hash).trim()).getTime() : Number.MAX_SAFE_INTEGER;
      // console.log("time", time)
      return { hash, time };
    }).sort((a, b) => a.time - b.time)[0];
    console.log(branch.hash)
    const hash = branch && branch.hash;
    if (!hash) return;
    return this._gitCmdClient.logParent(hash).trim().slice(0, 7);
  }

  getCandidateHashes(): string[] {
    const re = new RegExp(`^this._branchName$`);
    const mergedBranches = this.getBranchNames(this._commitNodes[0][0])
      .filter(b => !b.endsWith("/" + this._branchName) && !re.test(b));
    return this._commitNodes
      .map((c) => c[0])
      .filter(c => {
        const branches = this.getBranchNames(c);
        const hasCurrent = !!branches.find(b => this._branchName === b);
        const others = branches.filter(b => {
          return !(b.endsWith(this._branchName) || (mergedBranches.length && mergedBranches.some(c => b === c)));
        });
        return hasCurrent && !!others.length;
      });
  }

  getBaseCommitHash(): string | null {
    this._branchName = this.getCurrentBranchName();
    this._commitNodes = this.getCommitNodes();
    const candidateHashes = this.getCandidateHashes();
    const branchHash = this.getBranchHash(candidateHashes);
    console.log(branchHash)
    if (!branchHash) return null;
    const baseHash = this.findBaseCommitHash(candidateHashes, branchHash);
    if (!baseHash) return null;
    const result = this._gitCmdClient.revParse(baseHash).replace("\n", "");
    return result ? result : null;
  }

  findBaseCommitHash(candidateHashes: string[], branchHash: string): string | undefined {
    const traverseLog = (candidateHash: string): boolean | undefined => {
      if (candidateHash === branchHash) return true;
      const hits = this.findParentNode(candidateHash);
      if (!hits || !hits.length) return false;
      const [target, ...hitParentsHashes] = hits;
      for (const h of hitParentsHashes) {
        if (target === branchHash) return true;
        return traverseLog(h);
      }
    };
    const target = candidateHashes.find((hash) => !!traverseLog(hash));
    return target;
  }
}
