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

        // 포트 노드들 찾기
        this.portNodes = this.portComponents.map(port => {
            const termKey = `${port.id}:start`;
            return this.terminalToNode.has(termKey) ? this.terminalToNode.get(termKey) : -1;
        });
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

            if (comp.type === 'TL') {
                this.addTransmissionLineToY(Y, comp, nodeMapping, nodeIndexMap, frequency);
            } else {
                this.addTwoTerminalToY(Y, comp, nodeMapping, nodeIndexMap, frequency);
            }
        });

        return { Y, nodeIndexMap, matrixSize };
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
     * Transmission Line을 Y-매트릭스에 추가
     */
    addTransmissionLineToY(Y, comp, nodeMapping, nodeIndexMap, frequency) {
        const node1 = nodeMapping.start;
        const node2 = nodeMapping.end;

        const abcd = comp.getABCDMatrix(frequency);

        const A = Complex.fromObject(abcd.A);
        const B = Complex.fromObject(abcd.B);
        const C = Complex.fromObject(abcd.C);
        const D = Complex.fromObject(abcd.D);

        if (B.isZero()) {
            console.warn('Transmission line B parameter is zero');
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
            return new Complex(0, 0);
        }

        const portIdx = nodeIndexMap.get(this.portNode);
        if (portIdx === undefined || portIdx < 0) {
            // console.warn('Port node not found in matrix');
            return new Complex(Infinity, 0);
        }

        const I = [];
        for (let i = 0; i < matrixSize; i++) {
            I.push(new Complex(i === portIdx ? 1 : 0, 0));
        }

        try {
            const V = ComplexMatrix.solve(Y, I);
            const Zin = V[portIdx];

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
            return this.getDefaultSParams(portCount);
        }

        // 포트 인덱스 매핑
        const portIndices = this.portNodes.map(node => nodeIndexMap.get(node));

        // 일부 포트가 매핑되지 않은 경우 (예: 그라운드에 연결됨)
        // 그라운드 연결이면 undefined일 수 있음. 처리 필요.

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

        // *** Better approach: Compute Z-matrix first, then S-matrix ***
        // Z_ij = V_i / I_j (Apply 1A at Port j, Measure V at Port i)

        const Zp = new ComplexMatrix(portCount, portCount);

        for (let j = 0; j < portCount; j++) {
            const idxJ = portIndices[j];
            if (idxJ === undefined || idxJ < 0) {
                // Port J is grounded. V_j is always 0.
                // If we drive it? We can't drive a ground node with ideal current source (V=0, I=1 -> P=0? Conflict).
                // Actually, if port is shorted, Z_jj = 0.
                // But wait, if we short it, we can't drive 1A and measure V. Current flows to ground. V=0.
                // So column J of Z-matrix is 0?
                // Valid for passive? Yes.
                for (let i = 0; i < portCount; i++) Zp.set(i, j, new Complex(0, 0));
                continue;
            }

            // Excitation vector I
            const Ivec = [];
            for (let k = 0; k < matrixSize; k++) {
                Ivec.push(new Complex(k === idxJ ? 1 : 0, 0));
            }

            try {
                // Solve V for excitation at Port J
                const Vvec = ComplexMatrix.solve(Y, Ivec);

                // Read V at all ports to fill Z column j
                for (let i = 0; i < portCount; i++) {
                    const idxI = portIndices[i];
                    if (idxI === undefined || idxI < 0) {
                        Zp.set(i, j, new Complex(0, 0)); // Port I is grounded -> V=0
                    } else {
                        Zp.set(i, j, Vvec[idxI]);
                    }
                }
            } catch (e) {
                // Solver failed (e.g., floating node, singular matrix)
                // console.warn('Solver failed for port', j);
                return this.getDefaultSParams(portCount);
            }
        }

        // Convert Z-matrix to S-matrix
        // S = (Z - Z0*I) * (Z + Z0*I)^(-1)
        const I = ComplexMatrix.identity(portCount);
        const Z0I = I.scale(new Complex(z0, 0));

        const ZminusZ0 = Zp.subtract(Z0I);
        const ZplusZ0 = Zp.add(Z0I);

        const ZplusZ0Inv = ZplusZ0.inverse();

        if (!ZplusZ0Inv) {
            return this.getDefaultSParams(portCount);
        }

        const S = ZminusZ0.multiply(ZplusZ0Inv);

        // S-파라미터 객체로 변환
        const result = {};
        for (let i = 0; i < portCount; i++) {
            for (let j = 0; j < portCount; j++) {
                const key = `S${i + 1}${j + 1}`;
                result[key] = S.get(i, j);
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
}

// 전역 노출
window.NetworkAnalyzer = NetworkAnalyzer;
