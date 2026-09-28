import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';

import { PillarShape } from '../constants';


export interface PillarInstance {
    centre: Vector3;
    height: number;
    /** circumradius of the hexagon */
    radius: number;
    /** rotation around the pillar's own axis, then the lean */
    spinRad: number;
    leanRad: number;
    rollRad: number;
    uvOffsetU: number;
    uvOffsetV: number;
    /** chipped edge around the ends, 0 for a sharp pillar */
    bevel: number;
}

// rings from bottom to top: the (inset) bottom cap, the bottom edge of the sides, optionally one where the water cuts
// across them, their top edge, the (inset) top cap
const enum Ring { BottomCap, BottomEdge, Water, TopEdge, TopCap }
const enum Kind { Side, Cap }

interface TemplateVertex {
    ring: Ring;
    corner: number;
    kind: Kind;
    /** index into the cumulative perimeter, n for the seam so the texture doesn't wrap backwards */
    perimeterIndex: number;
    /** on the Water ring: 1 for the band above it (its copy sits just above the water), -1 for the one below */
    waterSide: number;
}

interface Template {
    polygon: number[][];
    perimeter: number[];
    vertices: TemplateVertex[];
    indices: number[];
}

/**
 * Unit hexagon (circumradius 1) in x/z with each corner cut off by `chamfer` (fraction of an edge), counter-clockwise
 */
const chamferedHexagon = (chamfer: number): number[][] => {
    const hex = Array.from({ length: 6 }, (_, k) => [Math.cos(k * Math.PI / 3), Math.sin(k * Math.PI / 3)]);
    if (chamfer <= 0) return hex;

    const points: number[][] = [];
    for (let k = 0; k < 6; k++) {
        const p = hex[k], prev = hex[(k + 5) % 6], next = hex[(k + 1) % 6];
        points.push([p[0] + chamfer * (prev[0] - p[0]), p[1] + chamfer * (prev[1] - p[1])]);
        points.push([p[0] + chamfer * (next[0] - p[0]), p[1] + chamfer * (next[1] - p[1])]);
    }
    return points;
};

const vertexPosition = (template: Template, v: TemplateVertex, radius: number, height: number, bevel: number, out: number[]) => {
    const inset = v.ring === Ring.BottomCap || v.ring === Ring.TopCap;
    const r = inset ? radius - bevel : radius;
    const [px, pz] = template.polygon[v.corner];
    const half = height / 2;
    const y = v.ring === Ring.BottomCap ? -half
        : v.ring === Ring.BottomEdge ? -half + bevel
        // placed on the waterline by buildPillarMesh
        : v.ring === Ring.Water ? 0
        : v.ring === Ring.TopEdge ? half - bevel
        : half;
    out[0] = px * r;
    out[1] = y;
    out[2] = pz * r;
};

/**
 * Topology shared by pillars: flat faces with their own vertices so each face gets its own texture mapping.
 * Without a bevel the sides run straight from cap to cap; with one there's a slanted ring between sides and caps.
 */
const buildTemplate = (chamfer: number, bevelled: boolean, waterRing: boolean): Template => {
    const polygon = chamferedHexagon(chamfer);
    const n = polygon.length;

    const perimeter = [0];
    for (let k = 0; k < n; k++) {
        const a = polygon[k], b = polygon[(k + 1) % n];
        perimeter.push(perimeter[k] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }

    const template: Template = { polygon, perimeter, vertices: [], indices: [] };
    const add = (ring: Ring, corner: number, kind: Kind, perimeterIndex: number, waterSide = 0) => template.vertices.push({ ring, corner, kind, perimeterIndex, waterSide }) - 1;
    const band = (lower: Ring, upper: Ring) => {
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const a = add(lower, i, Kind.Side, i, 1), b = add(lower, j, Kind.Side, i + 1, 1);
            const c = add(upper, j, Kind.Side, i + 1, -1), d = add(upper, i, Kind.Side, i, -1);
            template.indices.push(a, b, c, a, c, d);
        }
    };

    // the sides, split where the water crosses them if asked
    const sides = (lower: Ring, upper: Ring) => {
        if (waterRing) {
            band(lower, Ring.Water);
            band(Ring.Water, upper);
        } else {
            band(lower, upper);
        }
    };
    if (bevelled) {
        band(Ring.BottomCap, Ring.BottomEdge);
        sides(Ring.BottomEdge, Ring.TopEdge);
        band(Ring.TopEdge, Ring.TopCap);
    } else {
        sides(Ring.BottomCap, Ring.TopCap);
    }
    for (const ring of [Ring.BottomCap, Ring.TopCap]) {
        const first = template.vertices.length;
        for (let i = 0; i < n; i++) add(ring, i, Kind.Cap, i);
        for (let i = 1; i < n - 1; i++) template.indices.push(first, first + i, first + i + 1);
    }

    // the shape is convex around the origin, so every face normal should point away from it: flip the ones that don't
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    const ab = new Vector3(), ac = new Vector3(), centroid = new Vector3();
    for (let t = 0; t < template.indices.length; t += 3) {
        vertexPosition(template, template.vertices[template.indices[t]], 1, 2, 0.1, a);
        vertexPosition(template, template.vertices[template.indices[t + 1]], 1, 2, 0.1, b);
        vertexPosition(template, template.vertices[template.indices[t + 2]], 1, 2, 0.1, c);
        ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
        centroid.set(a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]);
        if (ab.cross(ac).dot(centroid) < 0) {
            [template.indices[t + 1], template.indices[t + 2]] = [template.indices[t + 2], template.indices[t + 1]];
        }
    }
    return template;
};


/**
 * All pillars as one mesh. Texture coordinates are in world units so the texture never stretches, and bevels keep their
 * size whatever the pillar's height. withPieceIndex adds a 'pieceIndex' attribute: which of the instances each vertex
 * belongs to. With waterLevel, the sides get an extra ring of vertices where the water crosses them.
 */
export const buildPillarMesh = (instances: PillarInstance[], shape: PillarShape, withPieceIndex = false, waterLevel?: number): BufferGeometry => {
    const sharp = buildTemplate(shape.chamfer, false, waterLevel !== undefined);
    const bevelled = buildTemplate(shape.chamfer, true, waterLevel !== undefined);
    const templateOf = (inst: PillarInstance) => inst.bevel > 0 ? bevelled : sharp;

    let vertexCount = 0, indexCount = 0;
    for (const inst of instances) {
        vertexCount += templateOf(inst).vertices.length;
        indexCount += templateOf(inst).indices.length;
    }

    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint32Array(indexCount);
    const pieceIndex = withPieceIndex ? new Float32Array(vertexCount) : null;

    const m = new Matrix4(), rot = new Matrix4();
    const local = [0, 0, 0];
    const p = new Vector3();
    let vBase = 0, iBase = 0, piece = 0;

    for (const inst of instances) {
        const template = templateOf(inst);
        // never let the bevel eat the whole pillar
        const bevel = Math.min(inst.bevel, inst.radius * 0.4, inst.height * 0.25);

        m.makeRotationZ(inst.rollRad)
            .multiply(rot.makeRotationX(inst.leanRad))
            .multiply(rot.makeRotationY(inst.spinRad));
        m.setPosition(inst.centre);
        const axisY = m.elements[5];
        const half = inst.height / 2;

        template.vertices.forEach((v, k) => {
            vertexPosition(template, v, inst.radius, inst.height, bevel, local);
            if (v.ring === Ring.Water && waterLevel !== undefined && Math.abs(axisY) > 1e-3) {
                // on the waterline itself, along this corner's edge: seen from under the water, what's above the surface
                // shows bent into the window overhead while what's below doesn't, and the two parts of the pillar come
                // apart there. So the band above gets its own copy of the ring a hair above the water, the band below
                // one a hair below
                const level = waterLevel + v.waterSide * 0.002;
                const cornerY = m.elements[1] * local[0] + m.elements[9] * local[2];
                local[1] = Math.min(Math.max((level - inst.centre.y - cornerY) / axisY, -half + bevel + 0.01), half - bevel - 0.01);
            }
            p.set(local[0], local[1], local[2]).applyMatrix4(m);

            const vi = vBase + k;
            positions[vi * 3] = p.x;
            positions[vi * 3 + 1] = p.y;
            positions[vi * 3 + 2] = p.z;

            // sides wrap around the perimeter, caps are mapped straight down
            const u = v.kind === Kind.Cap ? local[0] : template.perimeter[v.perimeterIndex] * inst.radius;
            const w = v.kind === Kind.Cap ? local[2] : local[1];
            uvs[vi * 2] = u * shape.textureScale + inst.uvOffsetU;
            uvs[vi * 2 + 1] = w * shape.textureScale + inst.uvOffsetV;
        });

        pieceIndex?.fill(piece++, vBase, vBase + template.vertices.length);
        for (let k = 0; k < template.indices.length; k++) indices[iBase + k] = vBase + template.indices[k];
        vBase += template.vertices.length;
        iBase += template.indices.length;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setIndex(new BufferAttribute(indices, 1));
    if (pieceIndex) geometry.setAttribute('pieceIndex', new BufferAttribute(pieceIndex, 1));
    geometry.computeVertexNormals();
    return geometry;
};
