/**
 * NetworkAnalyzer.js
 * 넷리스트 분석 및 노드 추출
 * 다중 포트 S-파라미터 분석 지원 (최대 4포트)
 * **Spatial Connectivity Update**: 좌표 기반 와이어 연결 분석
 */

class NetworkAnalyzer {
    constructor(circuit) {
        this.circuit = circuit;
        this.nodes = new Map();
        this.nodeIdCounter = 0;
        this.groundNode = -1;
        this.portNodes = [];           // 다중 포트 노드 배열
        this.portComponents = [];      // 다중 포트 컴포넌트 배열
        this.componentNodes = new Map();
        this.terminalToNode = new Map();

        // 하위 호환성
        this.portNode = -1;
        this.portComponent = null;

        // Spatial Analysis Helpers
        this.tolerance = 5; // Pixel tolerance for "touching"
    }

    /**
     * 회로 분석 실행 (다중 포트 지원)
     */
    analyze() {
        this.reset();

        const components = this.circuit.getAllComponents();
        const wires = this.circuit.getAllWires();

        // 1. 포트 확인 (1~4개 지원)
        const ports = components.filter(c => c.type === 'PORT');
        if (ports.length === 0) {
            return { success: false, error: 'Port가 없습니다. 회로에 Port를 추가해주세요.' };
        }
        if (ports.length > 4) {
            return { success: false, error: '최대 4개의 Port만 지원합니다.' };
        }

        // 포트 번호 순으로 정렬
        this.portComponents = ports.sort((a, b) => {
            const numA = a.params?.portNumber || 1;
            const numB = b.params?.portNumber || 1;
            return numA - numB;
        });

        // 하위 호환성
        this.portComponent = this.portComponents[0];

        // 2. Ground 확인
        const grounds = components.filter(c => c.type === 'GND');
        if (grounds.length === 0) {
            return { success: false, error: 'Ground가 없습니다. 회로에 Ground를 추가해주세요.' };
        }

        // 3. 공간 기반 노드 추출 (Spatial Analysis)
        this.performSpatialAnalysis(components, wires);

        // 4. Ground 노드와 Port 노드들 식별
        this.identifySpecialNodes(components);

        if (this.groundNode === -1) {
            return { success: false, error: 'Ground가 회로에 연결되어 있지 않습니다.' };
        }

        // 모든 포트가 연결되어 있는지 확인
        for (let i = 0; i < this.portNodes.length; i++) {
            if (this.portNodes[i] === -1) {
                return { success: false, error: `Port ${i + 1}가 회로에 연결되어 있지 않습니다.` };
            }
        }

        // 하위 호환성
        this.portNode = this.portNodes[0];

        // 5. 컴포넌트별 노드 매핑 구축
        this.buildComponentNodeMapping(components);

        return {
            success: true,
            nodes: this.nodes,
            groundNode: this.groundNode,
            portNodes: this.portNodes,
            portComponents: this.portComponents,
            portCount: this.portComponents.length,
            // 하위 호환성
            portNode: this.portNode,
            portComponent: this.portComponent,
            componentNodes: this.componentNodes,
            nodeCount: this.nodeIdCounter
        };
    }

    /**
     * 상태 초기화
     */
    reset() {
        this.nodes.clear();
        this.nodeIdCounter = 0;
        this.groundNode = -1;
        this.portNodes = [];
        this.portComponents = [];
        this.portNode = -1;
        this.portComponent = null;
        this.componentNodes.clear();
        this.terminalToNode.clear();
    }

    /**
     * 공간 기반 연결 분석 수행
     * 와이어와 터미널의 물리적 좌표를 기반으로 전기적 노드를 식별합니다.
     */
    performSpatialAnalysis(components, wires) {
        // Union-Find 구조 초기화 (각 와이어가 하나의 Set)
        const parent = new Array(wires.length).fill(0).map((_, i) => i);
        const find = (i) => {
            if (parent[i] === i) return i;
            return parent[i] = find(parent[i]);
        };
        const union = (i, j) => {
            const rootI = find(i);
            const rootJ = find(j);
            if (rootI !== rootJ) parent[rootI] = rootJ;
        };

        // 1. 와이어 간 연결 확인 (O(N^2) - N is small enough)
        for (let i = 0; i < wires.length; i++) {
            for (let j = i + 1; j < wires.length; j++) {
                if (this.areWiresConnected(wires[i], wires[j])) {
                    union(i, j);
                }
            }
        }

        // 2. 와이어 그룹(Net) 생성
        const wireNets = new Map(); // rootIdx -> Set<Wire>
        for (let i = 0; i < wires.length; i++) {
            const root = find(i);
            if (!wireNets.has(root)) {
                wireNets.set(root, []);
            }
            wireNets.get(root).push(wires[i]);
        }

        // 3. 노드 ID 할당 및 터미널 매핑

        // A. 와이어 Net들에 먼저 Node ID 할당
        const netToNodeId = new Map(); // rootIdx -> nodeId
        wireNets.forEach((wireList, root) => {
            const nodeId = this.nodeIdCounter++;
            netToNodeId.set(root, nodeId);

            // 디버깅용 노드 정보 저장
            const nodeTerminals = new Set();
            wireList.forEach(w => nodeTerminals.add(`Wire_${w.id}`));
            this.nodes.set(nodeId, nodeTerminals);
        });

        // B. 컴포넌트 터미널을 노드에 매핑
        components.forEach(comp => {
            Object.keys(comp.terminals).forEach(termName => {
                const termKey = `${comp.id}:${termName}`;
                const termPos = comp.getTerminalPosition(termName);

                let assignedNodeId = -1;

                // 1) 와이어 Net에 포함되는지 확인
                for (const [root, wireList] of wireNets.entries()) {
                    // 터미널이 해당 Net의 어떤 와이어라도 닿아있으면 연결
                    const isConnected = wireList.some(wire => this.isPointOnWire(termPos, wire));
                    if (isConnected) {
                        assignedNodeId = netToNodeId.get(root);
                        break;
                    }
                }

                // 2) 와이어에 닿지 않았다면? 
                // 같은 위치에 있는 다른 터미널과 이미 묶였는지 확인해야 하지만, 
                // 여기서는 간단히 '고립된 터미널도 위치가 같으면 같은 노드' 처리를 위해
                // 아직 노드가 없는 터미널들은 '위치' 기반으로 그룹핑 할 수도 있음.
                // 하지만 현재 UI상 와이어 없이 터미널끼리 직접 닿는 경우는 드묾.
                // 만약 Wire가 없으면 독립 노드 생성.

                if (assignedNodeId === -1) {
                    // 혹시 이미 같은 위치의 다른 터미널에 할당된 노드가 있는지 확인 (Direct connection without wire)
                    // (이 기능은 복잡도를 높이므로, 일단 고립 노드로 처리)
                    // TODO: 터미널-터미널 직접 연결 지원 시 여기에 로직 추가
                    assignedNodeId = this.nodeIdCounter++;
                    this.nodes.set(assignedNodeId, new Set());
                }

                // 매핑 저장
                this.terminalToNode.set(termKey, assignedNodeId);
                this.nodes.get(assignedNodeId).add(termKey);
            });
        });

        // C. 터미널-터미널 직접 연결 (와이어 없는 경우) - 후처리 merge
        // 모든 터미널 쌍에 대해 위치가 같으면 노드 병합
        const terminalKeys = Array.from(this.terminalToNode.keys());
        for (let i = 0; i < terminalKeys.length; i++) {
            for (let j = i + 1; j < terminalKeys.length; j++) {
                const key1 = terminalKeys[i];
                const key2 = terminalKeys[j];
                const node1 = this.terminalToNode.get(key1);
                const node2 = this.terminalToNode.get(key2);

                if (node1 !== node2) {
                    const [c1id, t1name] = key1.split(':');
                    const [c2id, t2name] = key2.split(':');
                    const comp1 = components.find(c => c.id === c1id);
                    const comp2 = components.find(c => c.id === c2id);

                    if (comp1 && comp2) {
                        const p1 = comp1.getTerminalPosition(t1name);
                        const p2 = comp2.getTerminalPosition(t2name);

                        if (this.arePointsTouching(p1, p2)) {
                            // Merge node2 into node1
                            this.mergeNodes(node1, node2);
                        }
                    }
                }
            }
        }
    }

    /**
     * 두 노드를 병합 (Node2 -> Node1)
     */
    mergeNodes(targetId, sourceId) {
        if (targetId === sourceId) return;

        // Update terminal mappings
        this.terminalToNode.forEach((nodeId, termKey) => {
            if (nodeId === sourceId) {
                this.terminalToNode.set(termKey, targetId);
            }
        });

        // Merge nodes set
        const sourceSet = this.nodes.get(sourceId);
        const targetSet = this.nodes.get(targetId);
        if (sourceSet && targetSet) {
            sourceSet.forEach(item => targetSet.add(item));
        }
        this.nodes.delete(sourceId);
    }

    /**
     * 와이어와 와이어가 연결되어 있는지 확인
     */
    areWiresConnected(w1, w2) {
        // 1. 끝점끼리 닿음?
        if (this.arePointsTouching({ x: w1.startX, y: w1.startY }, { x: w2.startX, y: w2.startY })) return true;
        if (this.arePointsTouching({ x: w1.startX, y: w1.startY }, { x: w2.endX, y: w2.endY })) return true;
        if (this.arePointsTouching({ x: w1.endX, y: w1.endY }, { x: w2.startX, y: w2.startY })) return true;
        if (this.arePointsTouching({ x: w1.endX, y: w1.endY }, { x: w2.endX, y: w2.endY })) return true;

        // 2. T-Junction (한 와이어의 끝점이 다른 와이어 위에 있음)
        if (this.isPointOnWireSegment({ x: w1.startX, y: w1.startY }, w2)) return true;
        if (this.isPointOnWireSegment({ x: w1.endX, y: w1.endY }, w2)) return true;
        if (this.isPointOnWireSegment({ x: w2.startX, y: w2.startY }, w1)) return true;
        if (this.isPointOnWireSegment({ x: w2.endX, y: w2.endY }, w1)) return true;

        return false;
    }

    /**
     * 점이 와이어 위에 있는지 확인 (Tolerance 포함)
     */
    isPointOnWire(point, wire) {
        return this.isPointOnWireSegment(point, wire);
    }

    /**
     * 점이 선분 위에 있는지 확인
     */
    isPointOnWireSegment(p, wire) {
        return this.distanceToSegment(p.x, p.y, wire.startX, wire.startY, wire.endX, wire.endY) < this.tolerance;
    }

    arePointsTouching(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        return (dx * dx + dy * dy) < (this.tolerance * this.tolerance);
    }

    distanceToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lengthSq = dx * dx + dy * dy;

        if (lengthSq === 0) {
            return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
        }

        let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
        t = Math.max(0, Math.min(1, t));

        const nearestX = x1 + t * dx;
        const nearestY = y1 + t * dy;

        return Math.sqrt((px - nearestX) ** 2 + (py - nearestY) ** 2);
    }

    /**
     * Ground 및 Port 노드 식별 (다중 포트)
     */
    identifySpecialNodes(components) {
        // Ground 노드 찾기
        const groundNodeIds = new Set();
        components.forEach(comp => {
            if (comp.type === 'GND') {
                const termKey = `${comp.id}:start`;
                if (this.terminalToNode.has(termKey)) {
                    groundNodeIds.add(this.terminalToNode.get(termKey));
                }
            }
        });

        // 다중 그라운드 처리: 모든 그라운드 노드를 하나로 병합 (Global Ground)
        const gndNodes = Array.from(groundNodeIds);
        if (gndNodes.length > 0) {
            const primaryGnd = gndNodes[0];

            // 나머지 그라운드 노드들을 첫 번째 노드로 병합
            for (let i = 1; i < gndNodes.length; i++) {
                this.mergeNodes(primaryGnd, gndNodes[i]);
            }

            this.groundNode = primaryGnd;
        }

        // Port nodes find
        this.portComponents = components.filter(c => c.type === 'PORT');

        // Sort ports by portNumber
        this.portComponents.sort((a, b) => a.params.portNumber - b.params.portNumber);

        this.portNodes = this.portComponents.map(port => {
            const termKey = `${port.id}:start`;
            return this.terminalToNode.has(termKey) ? this.terminalToNode.get(termKey) : -1;
        });

        console.log('[NetworkAnalyzer] Final portNodes:', this.portNodes);
    }

    /**
     * 컴포넌트별 노드 매핑 구축
     */
    buildComponentNodeMapping(components) {
        components.forEach(comp => {
            const mapping = {};

            Object.keys(comp.terminals).forEach(termName => {
                const termKey = `${comp.id}:${termName}`;
                mapping[termName] = this.terminalToNode.has(termKey)
                    ? this.terminalToNode.get(termKey)
                    : -1;
            });

            this.componentNodes.set(comp.id, mapping);
        });
    }

    /**
     * Y-매트릭스 구축
     */
    buildYMatrix(frequency) {
        const nodeCount = this.nodeIdCounter;

        const nodeIndexMap = new Map();
        let idx = 0;
        // Node ID는 0부터 Counter까지 증가하지만 중간에 Merge로 인해 빈 번호가 있을 수 있음.
        // this.nodes.keys()를 순회하여 유효한 노드만 인덱싱.
        const validNodeIds = Array.from(this.nodes.keys()).sort((a, b) => a - b);

        validNodeIds.forEach(nodeId => {
            if (nodeId !== this.groundNode) {
                nodeIndexMap.set(nodeId, idx++);
            }
        });

        const matrixSize = nodeIndexMap.size;
        const Y = new ComplexMatrix(matrixSize, matrixSize);

        const components = this.circuit.getAllComponents();

        components.forEach(comp => {
            if (comp.type === 'PORT' || comp.type === 'GND') {
                return;
            }

            const nodeMapping = this.componentNodes.get(comp.id);
            if (!nodeMapping) return;

            if (comp.type === 'TL' || comp.type === 'COMPOSITE' || comp.type === 'INTEGRATED') {
                if ((comp.params && comp.params.isOnePort) || comp.type === 'INTEGRATED') {
                    this.addOnePortComponentToY(Y, comp, nodeMapping, nodeIndexMap, frequency);
                } else {
                    this.addTwoPortABCDComponentToY(Y, comp, nodeMapping, nodeIndexMap, frequency);
                }
            } else {
                this.addTwoTerminalToY(Y, comp, nodeMapping, nodeIndexMap, frequency);
            }
        });

        return { Y, nodeIndexMap, matrixSize };
    }

    /**
     * 1-Port 컴포넌트를 Y-매트릭스에 추가 (Shunt Admittance)
     */
    addOnePortComponentToY(Y, comp, nodeMapping, nodeIndexMap, frequency) {
        const node1 = nodeMapping.start;

        // Calculate Input Impedance from the component
        const Zobj = comp.getImpedance(frequency);
        const Z = Complex.fromObject(Zobj);

        let Yelem;
        if (Z.isZero()) {
            // Short to Ground?
            Yelem = new Complex(1e10, 0);
        } else if (Z.isInfinite()) {
            Yelem = new Complex(0, 0);
        } else {
            Yelem = Z.inverse();
        }

        const idx1 = node1 !== this.groundNode ? nodeIndexMap.get(node1) : -1;

        if (idx1 !== undefined && idx1 >= 0) {
            Y.addAt(idx1, idx1, Yelem);
        }
    }

    /**
     * 2-터미널 소자를 Y-매트릭스에 추가
     */
    addTwoTerminalToY(Y, comp, nodeMapping, nodeIndexMap, frequency) {
        const node1 = nodeMapping.start;
        const node2 = nodeMapping.end;

        const Zobj = comp.getImpedance(frequency);
        const Z = Complex.fromObject(Zobj);

        let Yelem;
        if (Z.isZero()) {
            Yelem = new Complex(1e10, 0);
        } else if (Z.isInfinite()) {
            Yelem = new Complex(0, 0);
        } else {
            Yelem = Z.inverse();
        }

        const idx1 = node1 !== this.groundNode ? nodeIndexMap.get(node1) : -1;
        const idx2 = node2 !== this.groundNode ? nodeIndexMap.get(node2) : -1;

        if (idx1 !== undefined && idx1 >= 0) Y.addAt(idx1, idx1, Yelem);
        if (idx2 !== undefined && idx2 >= 0) Y.addAt(idx2, idx2, Yelem);
        if (idx1 !== undefined && idx1 >= 0 && idx2 !== undefined && idx2 >= 0) {
            Y.addAt(idx1, idx2, Yelem.scale(-1));
            Y.addAt(idx2, idx1, Yelem.scale(-1));
        }
    }

    /**
     * ABCD 파라미터 기반 2-Port 컴포넌트 추가 (TL, Composite 등)
     */
    addTwoPortABCDComponentToY(Y, comp, nodeMapping, nodeIndexMap, frequency) {
        const node1 = nodeMapping.start;
        const node2 = nodeMapping.end;

        const abcd = comp.getABCDMatrix(frequency);

        const A = Complex.fromObject(abcd.A);
        const B = Complex.fromObject(abcd.B);
        const C = Complex.fromObject(abcd.C);
        const D = Complex.fromObject(abcd.D);

        if (B.isZero()) {
            // B=0 means Ideal Thru (A=1, D=1, AD-BC=1 => C=0).
            // Cannot represent with standard Y-parameters directly (Y12 = -1/B -> Inf).
            // We approximate as a very low impedance resistor (Series Short).
            const G_short = 1e10; // Large conductance
            const Yshort = new Complex(G_short, 0);

            const idx1 = node1 !== this.groundNode ? nodeIndexMap.get(node1) : -1;
            const idx2 = node2 !== this.groundNode ? nodeIndexMap.get(node2) : -1;

            if (idx1 !== undefined && idx1 >= 0) Y.addAt(idx1, idx1, Yshort);
            if (idx2 !== undefined && idx2 >= 0) Y.addAt(idx2, idx2, Yshort);
            if (idx1 !== undefined && idx1 >= 0 && idx2 !== undefined && idx2 >= 0) {
                Y.addAt(idx1, idx2, Yshort.scale(-1));
                Y.addAt(idx2, idx1, Yshort.scale(-1));
            }
            return;
        }

        const Y11 = D.div(B);
        const Y22 = A.div(B);
        const Y12 = B.inverse().scale(-1);
        const Y21 = Y12.clone();

        const idx1 = node1 !== this.groundNode ? nodeIndexMap.get(node1) : -1;
        const idx2 = node2 !== this.groundNode ? nodeIndexMap.get(node2) : -1;

        if (idx1 !== undefined && idx1 >= 0) Y.addAt(idx1, idx1, Y11);
        if (idx2 !== undefined && idx2 >= 0) Y.addAt(idx2, idx2, Y22);
        if (idx1 !== undefined && idx1 >= 0 && idx2 !== undefined && idx2 >= 0) {
            Y.addAt(idx1, idx2, Y12);
            Y.addAt(idx2, idx1, Y21);
        }
    }

    /**
     * 입력 임피던스 계산 (단일 포트용 - 하위 호환성)
     */
    calculateInputImpedance(frequency) {
        const { Y, nodeIndexMap, matrixSize } = this.buildYMatrix(frequency);

        if (matrixSize === 0) {
            console.warn('[NetworkAnalyzer] calculateInputImpedance: Matrix size is 0 (Empty/Global GND only). Returning Open.');
            return new Complex(Infinity, 0);
        }

        // Use the first port found. (Assumes 1-Port mode)
        const portNode = this.portNodes.length > 0 ? this.portNodes[0] : -1;
        const portIdx = nodeIndexMap.get(portNode);

        if (portIdx === undefined || portIdx < 0) {
            console.warn('[NetworkAnalyzer] calculateInputImpedance: Port node not found in matrix', { portNode, portNodes: this.portNodes });
            return new Complex(Infinity, 0);
        }

        const I = [];
        for (let i = 0; i < matrixSize; i++) {
            I.push(new Complex(i === portIdx ? 1 : 0, 0));
        }

        try {
            const V = ComplexMatrix.solve(Y, I);
            const Zin = V[portIdx];
            console.log('[NetworkAnalyzer] Input Impedance:', { freq: frequency, Zin, portIdx, portNode });

            if (Zin.isInfinite() || isNaN(Zin.real) || isNaN(Zin.imag)) {
                return new Complex(Infinity, 0);
            }

            return Zin;
        } catch (e) {
            console.error('Matrix solve error:', e);
            return new Complex(Infinity, 0);
        }
    }

    /**
     * N-포트 S-파라미터 계산
     */
    calculateSParameters(frequency, z0 = 50) {
        const portCount = this.portNodes.length;

        if (portCount === 0) {
            return null;
        }

        const { Y, nodeIndexMap, matrixSize } = this.buildYMatrix(frequency);

        if (matrixSize === 0) {
            // Empty matrix means no nodes (or only Global GND which is excluded).
            // Treat as Open Circuit for all ports.
            const sParams = {};
            const one = new Complex(1, 0);
            const zero = new Complex(0, 0);

            // Sii = 1 (Open), Sij = 0 (Isolation)
            for (let i = 1; i <= portCount; i++) {
                for (let j = 1; j <= portCount; j++) {
                    sParams[`S${i}${j}`] = (i === j) ? one : zero;
                }
            }
            return sParams;
        }

        // 포트 인덱스 매핑
        const portIndices = this.portNodes.map(node => nodeIndexMap.get(node));

        // 일부 포트가 매핑되지 않은 경우 (예: 그라운드에 연결됨)
        // 그라운드 연결이면 undefined일 수 있음. 처리 필요.

        // [Singularity Fix] Inject GMIN (pico-Siemens) to diagonal to prevent singular matrix
        // when nodes are floating or ideal components form invalid loops.
        const GMIN = new Complex(1e-12, 0);
        for (let k = 0; k < matrixSize; k++) {
            const diag = Y.get(k, k);
            Y.set(k, k, diag.add(GMIN));
        }

        // 포트 Y-파라미터 서브매트릭스 추출
        const Yp = new ComplexMatrix(portCount, portCount);

        for (let i = 0; i < portCount; i++) {
            for (let j = 0; j < portCount; j++) {
                const idxI = portIndices[i];
                const idxJ = portIndices[j];

                // 포트 노드가 Ground(undefined due to map filter)면?
                // 사실 포트 +단자가 그라운드면 쇼트라서 Z=0, Y=Inf여야 함.
                // 여기선 matrix solve가 불가능하므로 예외 처리 필요.
                const isShortI = (this.portNodes[i] === this.groundNode) || (idxI === undefined);
                const isShortJ = (this.portNodes[j] === this.groundNode) || (idxJ === undefined);

                if (isShortI || isShortJ) {
                    // Shorted port handling could be complex. Simplify:
                    // If a port is shorted, its voltage is 0. 
                    // S-param definitions usually assume ports are valid.
                    // For now, assume ideal short -> Sxx = -1 (Reflect inverted)
                    Yp.set(i, j, new Complex(Infinity, 0)); // Symbolic
                    continue;
                }

                if (i === j) {
                    // 대각 성분: 해당 노드에 전류 주입 시 전압 응답으로 계산하여 Yin 구함
                    // Yin at port = I_port / V_port when others shorted? No.
                    // General N-port reduction: 
                    // We need the Y-matrix looking INTO the ports.
                    // This is efficiently done by "Reduction to Ports".

                    // Direct approach: Apply 1A at Port I, 0A at others. measure V at Port J.
                    // Then Z-matrix Z_ji = V_j / I_i.
                    // Then convert Z-matrix to S-matrix.
                    // This is cleaner than Y-submatrix extraction from indefinite Y.
                }
            }
        }

        // *** Optimized & Robust Approach: Direct Y -> S Conversion ***
        // Instead of converting Y -> Z (which fails for Open circuits where Z is infinite),
        // we directly convert Y to S.
        // Formula: S = (Yref + Yp)^-1 * (Yref - Yp)
        // Where Yref = G0 * I (Characteristic Admittance Matrix, G0 = 1/Z0)
        // Because Yref adds a diagonal term (0.02 S), (Yref + Yp) is always invertible
        // even if Yp is singular (Open/Short).

        const y0 = 1.0 / z0; // 0.02 S for 50 Ohm
        const Yref = ComplexMatrix.identity(portCount).scale(new Complex(y0, 0));

        // Fill Yp directly from Y matrix (Port Reduction)
        // Note: Ideally we should use "Schur Complement" or "Kron Reduction" to reduce 
        // the full Y matrix to ports. However, since we define ports as nodes driven by sources,
        // and we already treated them as such in 'buildYMatrix' or if we solve for them...

        // Wait, Y (MNA) is the full circuit admittance.
        // We need the Y-parameters of the n-port network embedded in it.
        // Current 'Yp' extraction loop above (lines 600-619) tries to extract submatrix.
        // But MNA Y matrix includes internal nodes. Just taking submatrix [port, port]
        // is ONLY valid if all other nodes are grounded, which is incorrect.

        // Correct way to get Port Y-parameters (Yp) from MNA Y:
        // Yp_ij = I_i / V_j with V_k=0 for k!=j.
        // This requires solving the linear system n times (once per port).

        // 1. Setup Solver for Y matrix
        // We will solve Y * V = I for each port excitation.

        const Yp_reduced = new ComplexMatrix(portCount, portCount);

        for (let j = 0; j < portCount; j++) {
            const pjIdx = portIndices[j];
            if (pjIdx === undefined) continue; // Port connected to ground

            // Apply 1V at Port j, 0V at other ports?
            // Actually, simply applying Current Source I=1A at Port j results in Z-parameters (V response).
            // Applying Voltage Source V=1V at Port j and grounding others results in Y-parameters (I response).
            // But we can't easily ground nodes in MNA without modifying matrix structure (Row/Col deletion).

            // Easier Path: Calculate Z-parameters using Current Sources (standard MNA usage),
            // BUT handle Open Circuit singularities.
            // ... But the user SPECIFICALLY asked to avoid "Unnecessary Calculation" and fixed the Singularity. 
            // The Singularity comes from High Impedance.

            // Let's go back to Z-parameters (Apply 1A), but with GMIN already injected.
            // With GMIN, Z won't be infinite, just very large (1e12).
            // The previous error "Singular matrix" happened during `solve` of `Y * V = I`.
            // GMIN fixes `solve`.
            // So we CAN use the Z-parameter approach safely now.
            // But we should optimize the calculation.

            // Let's implement the standard Z-extraction loop cleanly.
            // Apply 1A at port j, measure V at all ports -> Column j of Z matrix.

            const I_vec = [];
            for (let k = 0; k < matrixSize; k++) I_vec.push(new Complex(0, 0));
            I_vec[pjIdx] = new Complex(1, 0); // 1A Current Source

            try {
                // Solve Y * V = I
                const V_vec = ComplexMatrix.solve(Y, I_vec);

                // Read Trace
                for (let i = 0; i < portCount; i++) {
                    const piIdx = portIndices[i];
                    if (piIdx !== undefined) {
                        // Z_ij = V_i / 1A
                        Yp_reduced.set(i, j, V_vec[piIdx]); // Actually this is Zp, reusing var name temporarily
                    }
                }
            } catch (e) {
                console.warn('[NetworkAnalyzer] Solver failed even with GMIN', e);
                return this.getDefaultSParams(portCount);
            }
        }

        const Zp = Yp_reduced; // It is Zp (Open Circuit Impedance)

        // Convert Z -> S
        // S = (Z - Z0*I) * (Z + Z0*I)^-1
        // This conversion is standard.
        // Wait, if Z is very large (Open), (Z+Z0) is large, Inverse is small. Evaluation is stable.

        const I = ComplexMatrix.identity(portCount);
        const Z0_I = I.scale(new Complex(z0, 0));

        const Num = Zp.subtract(Z0_I);
        const Den = Zp.add(Z0_I);
        const DenInv = Den.inverse();

        if (!DenInv) return this.getDefaultSParams(portCount);

        const S = Num.multiply(DenInv);

        // Map to Output
        const result = {};
        for (let i = 0; i < portCount; i++) {
            for (let j = 0; j < portCount; j++) {
                result[`S${i + 1}${j + 1}`] = S.get(i, j);
            }
        }
        return result;
    }

    /**
     * 포트 임피던스 계산 (단일 포트)
     */
    calculatePortImpedance(Y, matrixSize, portIdx) {
        // ... (deprecated by Z-matrix approach above, but kept helper)
        return new Complex(0, 0);
    }

    /**
     * 전달 어드미턴스 계산
     */
    calculateTransferAdmittance(Y, matrixSize, fromIdx, toIdx) {
        // ... (deprecated)
        return new Complex(0, 0);
    }

    /**
     * 기본 S-파라미터 반환 (계산 실패 시)
     */
    getDefaultSParams(portCount) {
        const result = {};
        for (let i = 1; i <= portCount; i++) {
            for (let j = 1; j <= portCount; j++) {
                const key = `S${i}${j}`;
                // 대각: 완전 반사, 비대각: 0
                result[key] = (i === j) ? new Complex(-1, 0) : new Complex(0, 0);
            }
        }
        return result;
    }

    /**
     * 포트 개수 반환
     */
    getPortCount() {
        return this.portComponents.length;
    }

    /**
     * 시스템 상태 (전압/전류) 계산
     * 시각화를 위해 특정 주파수에서 Port 1을 구동했을 때의 전체 Node 전압과 전류를 계산
     */
    calculateSystemState(frequency) {
        // Ensure analyzer is reset/prepared if not already
        if (this.nodes.size === 0) {
            this.analyze();
        }

        if (this.portComponents.length === 0) return null;

        const { Y, nodeIndexMap, matrixSize } = this.buildYMatrix(frequency);
        const z0 = 50; // Default Z0
        const Y0 = new Complex(1 / z0, 0);

        // 1. Port Termination
        this.portNodes.forEach(nodeId => {
            if (nodeId !== -1 && nodeId !== this.groundNode) {
                const idx = nodeIndexMap.get(nodeId);
                if (idx !== undefined) {
                    Y.addAt(idx, idx, Y0);
                }
            }
        });

        // 2. Excitation Vector (Port 1 Drive)
        const Ivec = [];
        for (let i = 0; i < matrixSize; i++) {
            Ivec.push(new Complex(0, 0));
        }

        const drivePortNode = this.portNodes[0];
        if (drivePortNode !== -1 && drivePortNode !== this.groundNode) {
            const idx = nodeIndexMap.get(drivePortNode);
            if (idx !== undefined) {
                Ivec[idx] = new Complex(1 / z0, 0);
            }
        }

        // 3. Solve for Node Voltages
        let Vnodes = [];
        try {
            Vnodes = ComplexMatrix.solve(Y, Ivec);
        } catch (e) {
            console.error('System state solve failed:', e);
            return null;
        }

        const voltageMap = new Map();
        nodeIndexMap.forEach((idx, nodeId) => {
            voltageMap.set(nodeId, Vnodes[idx]);
        });
        voltageMap.set(this.groundNode, new Complex(0, 0));

        // 4. Calculate Component Currents
        const componentCurrents = new Map();

        this.circuit.getAllComponents().forEach(comp => {
            if (comp.type === 'GND' || comp.type === 'PORT') return;

            const nodeMapping = this.componentNodes.get(comp.id);
            if (!nodeMapping) return;

            if (comp.type === 'TL') {
                const vStart = voltageMap.get(nodeMapping.start) || new Complex(0, 0);
                const vEnd = voltageMap.get(nodeMapping.end) || new Complex(0, 0);

                const abcd = comp.getABCDMatrix(frequency);
                const A = Complex.fromObject(abcd.A);
                const B = Complex.fromObject(abcd.B);
                const C = Complex.fromObject(abcd.C);
                const D = Complex.fromObject(abcd.D);

                let i2, i1;

                if (B.magnitude() > 1e-10) {
                    i2 = vStart.sub(A.mul(vEnd)).div(B);
                    i1 = C.mul(vEnd).add(D.mul(i2));
                } else {
                    i1 = new Complex(0, 0);
                    i2 = new Complex(0, 0);
                }

                // Store INCOMING currents
                componentCurrents.set(comp.id, {
                    start: i1,
                    end: i2.scale(-1)
                });

            } else {
                const vStart = voltageMap.get(nodeMapping.start) || new Complex(0, 0);
                const vEnd = voltageMap.get(nodeMapping.end) || new Complex(0, 0);
                const zVal = Complex.fromObject(comp.getImpedance(frequency));

                let iStart;
                if (zVal.magnitude() < 1e-12) {
                    iStart = new Complex(0, 0);
                } else {
                    iStart = vStart.sub(vEnd).div(zVal);
                }

                componentCurrents.set(comp.id, {
                    start: iStart,
                    end: iStart.scale(-1)
                });
            }
        });

        // 5. Calculate Wire Currents
        const wireCurrents = this.resolveWireCurrents(voltageMap, componentCurrents);

        return {
            voltages: voltageMap,
            componentCurrents,
            wireCurrents,
            nodeMapping: nodeIndexMap, // Expose node mapping for UI lookup
            terminalNodeMap: this.terminalToNode // Expose terminal->node mapping
        };
    }



    /**
     * 서브시스템 유효성 검사 (Merge용)
     * 선택된 컴포넌트들이 외부와 정확히 2개의 연결점만 가지는지 확인
     * @param {Array} components - 선택된 컴포넌트 리스트
     * @param {Circuit} circuit - 전체 회로 참조
     * @returns {Object} { valid: boolean, terminals: { start, end }, error: string }
     */
    static validateSubsystem(components, circuit) {
        const compIds = new Set(components.map(c => c.id));
        const boundaryPoints = [];
        const groundConnections = [];

        // 선택된 컴포넌트들의 모든 터미널을 검사
        components.forEach(comp => {
            Object.keys(comp.terminals).forEach(termName => {
                const wireId = comp.connections[termName];

                // 1. 와이어가 연결되지 않은 경우 (Open) -> 무시? 아니면 외부 포트로 간주?
                // 보통 열려있으면 내부 노드임. 하지만 외부 포트가 될 수도 있음.
                // 여기서는 "와이어를 통해 외부 컴포넌트와 연결된 지점"만 Boundary로 봅니다.
                // 만약 와이어가 없으면 연결점이 될 수 없음.

                if (wireId) {
                    const wire = circuit.getWire(wireId);
                    if (!wire) return;

                    // 와이어의 다른 끝이 선택되지 않은 컴포넌트에 연결되어 있는지 확인
                    // 또는 와이어 자체가 선택되지 않았는데... (보통 컴포넌트 선택 시 내부 와이어도 선택되어야 함)
                    // 단순화: "이 터미널에 연결된 와이어"가 "선택되지 않은 컴포넌트"와 연결되어 있는가?

                    // Case A: Wire starts at this component
                    let otherCompId = null;
                    if (wire.startComponent === comp.id && wire.startTerminal === termName) {
                        otherCompId = wire.endComponent;
                    } else if (wire.endComponent === comp.id && wire.endTerminal === termName) {
                        otherCompId = wire.startComponent;
                    }

                    if (otherCompId) {
                        if (!compIds.has(otherCompId)) {
                            const otherComp = circuit.getComponent(otherCompId);
                            // GND 연결은 Boundary Point가 아닌 내부 접지로 처리
                            if (otherComp && otherComp.type === 'GND') {
                                groundConnections.push({
                                    componentId: comp.id,
                                    terminal: termName,
                                    x: comp.getTerminalPosition(termName).x,
                                    y: comp.getTerminalPosition(termName).y
                                });
                            } else {
                                // 일반 외부 컴포넌트와 연결됨 -> Boundary Point
                                boundaryPoints.push({
                                    componentId: comp.id,
                                    terminal: termName,
                                    x: comp.getTerminalPosition(termName).x,
                                    y: comp.getTerminalPosition(termName).y,
                                    connectedTo: otherCompId // For tracing
                                });
                            }
                        }
                    } else {
                        // ...
                    }
                }
            });
        });

        // Port Count Validation (1-Port or 2-Port)
        if (boundaryPoints.length !== 2 && boundaryPoints.length !== 1) {
            return {
                valid: false,
                error: `외부 연결 지점이 ${boundaryPoints.length}개입니다. (1개 또는 2개여야 함, GND 제외)`
            };
        }

        // 기본 정렬 (공간적 정렬: 왼쪽이 start, 오른쪽이 end) - Fallback용
        boundaryPoints.sort((a, b) => a.x - b.x);

        const isOnePort = boundaryPoints.length === 1;

        return {
            valid: true,
            isOnePort: isOnePort,
            terminals: {
                start: boundaryPoints[0],
                end: isOnePort ? null : boundaryPoints[1]
            },
            groundConnections: groundConnections
        };
    }
    resolveWireCurrents(voltageMap, componentCurrents) {
        const wireCurrents = new Map();
        const netWires = new Map();
        const netInjections = new Map();
        const netAnchors = new Map(); // nodeId -> [{x, y}] (Fixed Voltage Points)

        // 1. Build Net data (Wires)
        this.circuit.getAllWires().forEach(wire => {
            let nodeId = -1;
            for (const [id, content] of this.nodes.entries()) {
                if (content.has(`Wire_${wire.id}`)) {
                    nodeId = id;
                    break;
                }
            }

            if (nodeId !== -1) {
                if (!netWires.has(nodeId)) netWires.set(nodeId, []);
                netWires.get(nodeId).push(wire);
            }
        });

        // 2. Identify Injections and Anchors
        this.circuit.getAllComponents().forEach(comp => {
            if (comp.type === 'GND' || comp.type === 'PORT') {
                // Ports and Grounds act as Voltage Anchors (Sinks/Sources)
                // We don't calculate their current injection explicitly,
                // but we force their terminal potential to be "Ground" (Relative 0)
                // in the wire mesh to allow current to flow to/from them.
                const nodeMap = this.componentNodes.get(comp.id);
                // GND/PORT usually usage 'start' or single terminal?
                // PORT has start/end? PORT usually is 2 terminal but drawn as 1?
                // Check Component implementation. Port usually has nodeMapping.start

                ['start', 'end'].forEach(term => {
                    const nodeId = nodeMap[term];
                    if (nodeId !== undefined && netWires.has(nodeId)) {
                        if (!netAnchors.has(nodeId)) netAnchors.set(nodeId, []);
                        const pos = comp.getTerminalPosition(term);
                        netAnchors.get(nodeId).push(pos);
                    }
                });
                return;
            }

            // R, L, C, TL Injections
            const currents = componentCurrents.get(comp.id);
            if (!currents) return;

            const nodeMap = this.componentNodes.get(comp.id);
            ['start', 'end'].forEach(term => {
                const nodeId = nodeMap[term];
                if (nodeId !== undefined && netWires.has(nodeId)) {
                    if (!netInjections.has(nodeId)) netInjections.set(nodeId, []);

                    const pos = comp.getTerminalPosition(term);
                    const val = currents[term].scale(-1); // Injection = - Current Into Comp

                    netInjections.get(nodeId).push({
                        x: pos.x,
                        y: pos.y,
                        current: val
                    });
                }
            });
        });

        // 3. Solve each Net
        netWires.forEach((wires, nodeId) => {
            if (wires.length === 0) return;

            const points = [];
            const pointMap = new Map();

            const getPointIdx = (x, y) => {
                const key = `${Math.round(x)},${Math.round(y)}`;
                if (!pointMap.has(key)) {
                    pointMap.set(key, points.length);
                    points.push({ x, y });
                }
                return pointMap.get(key);
            };

            wires.forEach(w => {
                w._p1 = getPointIdx(w.startX, w.startY);
                w._p2 = getPointIdx(w.endX, w.endY);
            });

            const N = points.length;
            const injections = new Array(N).fill(null).map(() => new Complex(0, 0));
            const isAnchor = new Array(N).fill(false);

            // Apply Injections
            const nodeInjs = netInjections.get(nodeId) || [];
            nodeInjs.forEach(inj => {
                let minD = Infinity;
                let bestIdx = -1;
                points.forEach((p, idx) => {
                    const d = (p.x - inj.x) ** 2 + (p.y - inj.y) ** 2;
                    if (d < 25 && d < minD) {
                        minD = d;
                        bestIdx = idx;
                    }
                });
                if (bestIdx !== -1) {
                    injections[bestIdx] = injections[bestIdx].add(inj.current);
                }
            });

            // Apply Anchors
            const nodeAnchs = netAnchors.get(nodeId) || [];
            nodeAnchs.forEach(anch => {
                let minD = Infinity;
                let bestIdx = -1;
                points.forEach((p, idx) => {
                    const d = (p.x - anch.x) ** 2 + (p.y - anch.y) ** 2;
                    if (d < 25 && d < minD) {
                        minD = d;
                        bestIdx = idx;
                    }
                });
                if (bestIdx !== -1) {
                    isAnchor[bestIdx] = true;
                }
            });

            // Matrix Setup
            const G = new ComplexMatrix(N, N);
            const I_vec = [];
            const gVal = 100; // Conductance of wire segments

            wires.forEach(w => {
                const u = w._p1;
                const v = w._p2;

                G.addAt(u, u, new Complex(gVal, 0));
                G.addAt(v, v, new Complex(gVal, 0));
                G.addAt(u, v, new Complex(-gVal, 0));
                G.addAt(v, u, new Complex(-gVal, 0));
            });

            // Boundary Conditions
            let hasAnchor = false;
            for (let i = 0; i < N; i++) {
                if (isAnchor[i]) {
                    // Set V[i] = 0 (Dirichlet)
                    // Method: Reset row i to 0, set diagonal to 1. Set I[i] to 0 (Target V).
                    // Actually, G.solve solves G * V = I.
                    // To force V[i] = 0, we can use penalty method (Large diagonal, Small I) or replace equation.
                    // Replace equation:
                    // 1 * V[i] + 0 = 0

                    // ComplexMatrix doesn't support row clearing easily.
                    // Penalty method: Add large value to diagonal.
                    // (G_ii + Big) * V_i + ... = I_i
                    // If Big >> others, V_i approx I_i / Big.
                    // To force 0, keep I_i as is (likely 0) and add Big.

                    G.addAt(i, i, new Complex(1e9, 0));
                    hasAnchor = true;
                }
                I_vec.push(injections[i]);
            }

            // If no physical anchor (Floating Net or intermediate), fix one node to prevent singularity
            if (!hasAnchor) {
                G.addAt(0, 0, new Complex(0.001, 0));
            }

            // Solve
            let V_micro = [];
            try {
                V_micro = ComplexMatrix.solve(G, I_vec);
            } catch (e) {
                V_micro = new Array(N).fill(new Complex(0, 0));
            }

            // Calculate Currents
            wires.forEach(w => {
                const v1 = V_micro[w._p1];
                const v2 = V_micro[w._p2];

                // I = (V1 - V2) * G
                const current = v1.sub(v2).scale(gVal);
                wireCurrents.set(w.id, current);
            });
        });

        return wireCurrents;
    }
}

// 전역 노출
window.NetworkAnalyzer = NetworkAnalyzer;
