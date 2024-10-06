import * as THREE from 'https://cdn.skypack.dev/three@0.134.0';
import { PointerLockControls } from 'https://cdn.skypack.dev/three@0.134.0/examples/jsm/controls/PointerLockControls.js';
import { RGBELoader } from 'https://cdn.skypack.dev/three@0.134.0/examples/jsm/loaders/RGBELoader.js';
import { FBXLoader } from 'https://cdn.skypack.dev/three@0.134.0/examples/jsm/loaders/FBXLoader.js';
import * as CANNON from 'https://cdn.skypack.dev/cannon-es@0.20.0';
import { ConvexGeometry } from 'https://cdn.skypack.dev/three@0.134.0/examples/jsm/geometries/ConvexGeometry.js';
import { BufferGeometryUtils } from "//cdn.skypack.dev/three@0.129.0/examples/jsm/utils/BufferGeometryUtils?min";

let mapMeshes = [];
const playerHeight = 20;
const playerRadius = 5;
let outlineMesh = null;
let grabConstraint = null;
let ghostBody = null; // Cuerpo invisible que sigue la cámara
let convexHull = new THREE.Mesh();
let mesh;
const SPHERE_COLLISION_GROUP = 0x0001;
const MAP_COLLISION_GROUP = 0x0002;
const animateCallbacks = [];
// Configurar el mundo de Cannon.js
const world = new CANNON.World();
world.gravity.set(0, -500, 0);  // Gravedad hacia abajo

// Crear el cuerpo del jugador en Cannon.js
const playerShape = new CANNON.Sphere(playerRadius);
const playerBody = new CANNON.Body({
    mass: 100,  // Masa del jugador
    position: new CANNON.Vec3(0, 50, 20),  // Posición inicial
    shape: playerShape,
    material: new CANNON.Material({
        friction: 2,
        restitution: 0.0
    })
});
playerBody.collisionFilterGroup = MAP_COLLISION_GROUP;
world.addBody(playerBody);



const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(0, 0); // Centro de la pantalla
let selectedObject = null;
let isDragging = false;

let grabbedObject = null;
let grabOffset = new THREE.Vector3();
let maxGrabDistance = 50; // Distancia máxima para agarrar un objeto
// Escena, cámara y renderizador
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

// Crear la malla visual en Three.js para el jugador
const playerGeometry = new THREE.SphereGeometry(playerRadius, 32, 32); // Puedes ajustar el número de segmentos para mejorar la apariencia
const playerMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000,      
    transparent: true,    
    opacity: 0         
}); 
const playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
scene.add(playerMesh);

const planeGeometry = new THREE.PlaneGeometry(25, 25)
const texture = new THREE.TextureLoader().load('img/grid.png')
const plane = new THREE.Mesh(
    planeGeometry,
    new THREE.MeshPhongMaterial({ map: texture })
)
plane.rotateX(-Math.PI / 2)
plane.position.y = -1
plane.receiveShadow = true
scene.add(plane)

const planeShape = new CANNON.Plane()
const planeBody = new CANNON.Body({ mass: 0 })
planeBody.addShape(planeShape)
planeBody.quaternion.setFromAxisAngle(
    new CANNON.Vec3(1, 0, 0),
    -Math.PI / 2
)
planeBody.position.y = plane.position.y
world.addBody(planeBody)
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// Añadir luces
const ambientLight = new THREE.AmbientLight(0xffffff,1);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1); // Intensity set to 0.5 to reduce harshness
directionalLight.position.set(0, 10, 0); // Position the light above the scene
directionalLight.target.position.set(0, 0, 0); // Point the light towards the center of the scene
scene.add(directionalLight);
scene.add(directionalLight.target);

const loader2 = new RGBELoader();
loader2.load('maphdr.hdr', function(texture) {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
    scene.background = texture;
});





// Crear un punto en el centro de la pantalla usando Three.js
const crosshairGeometry = new THREE.SphereGeometry(0.009, 32, 32); // Pequeña esfera
const crosshairMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff }); // Color blanco
const crosshair = new THREE.Mesh(crosshairGeometry, crosshairMaterial);

// Posicionar el crosshair delante de la cámara
crosshair.position.set(0, 0, -2);
camera.add(crosshair);
scene.add(camera);  // Asegúrate de agregar la cámara a la escena

// Cargar el modelo FBX
const loader = new FBXLoader();
let url = '3d/mapafaces3.fbx';
// Función para convertir geometría de Three.js a Trimesh de Cannon.js
let physicsObjects = [];  // Array para almacenar la relación entre cuerpos y mallas

function addPhysicsObject(mesh, body) {
    physicsObjects.push({ mesh, body });
}


function CreateTrimesh(geometry) {
    let vertices;
    if (geometry.index === null) {
        vertices = geometry.attributes.position.array;
    } else {
        const nonIndexedGeometry = geometry.clone().toNonIndexed();
        vertices = nonIndexedGeometry.attributes.position.array;
    }
    const indices = Array.from({ length: vertices.length / 3 }, (_, i) => i);

    return new CANNON.Trimesh(vertices, indices);
}

loader.load(url, (object) => {
    if (!object) {
        console.error('El modelo no se ha cargado correctamente.');
        return;
    }
    object.position.set(-15, -20, -20);
    object.scale.set(0.55, 0.55, 0.55);

    scene.add(object);
    object.updateMatrixWorld(true);

    object.traverse(function (child) {
        if (child instanceof THREE.Mesh) {

            child.material = new THREE.MeshBasicMaterial({ 
                color: child.material.color,
                map: child.material.map, // Mantiene la textura original, si la hay
                metalness: 1,
                roughness: 0.2 
            });

            child.updateMatrixWorld();
            child.geometry.attributes.position.needsUpdate = true;
            const box = new THREE.Box3().setFromObject(child);
            const size = new THREE.Vector3();
            box.getSize(size);
            const c = new THREE.Vector3();
            child.getWorldPosition(c);
            const nodeQuaternion = new THREE.Quaternion();
            child.getWorldQuaternion(nodeQuaternion);

            // Calculate relative scale based on the parent's scale
            const relativeScale = new THREE.Vector3();
            relativeScale.copy(object.scale);  // Parent scale
            relativeScale.multiply(child.scale); // Relative to child scale



            const position = child.geometry.attributes.position.array;
            const points = [];
            for (let i = 0; i < position.length; i += 3) {
                // Apply the relative scale
                points.push(new THREE.Vector3(
                    position[i] * relativeScale.x,
                    position[i + 1] * relativeScale.y,
                    position[i + 2] * relativeScale.z
                ));
            }

            const convexGeometry = new ConvexGeometry(points);
            const shape = CreateTrimesh(convexGeometry);
            const body = new CANNON.Body({ mass: 0 });
            body.addShape(shape);

            body.position.copy(c);
            body.quaternion.copy(nodeQuaternion);
            body.restitution = 0.0;
            body.friction = 1;
            body.collisionFilterGroup = MAP_COLLISION_GROUP;
            
            world.addBody(body);


        }
    });
}, undefined, function (error) {
    console.error('An error happened:', error);
});

let spheres = [];  // Array para almacenar las esferas visibles
let nameTags = [];  // Array para almacenar los nametags

function generateRandomName() {
    const prefixes = [
        "mask"
    ];

    const suffixes = [
        "001", "002", "003", "004", "005", "006", "007", "008", "009", "010",
        "011", "012", "013", "014", "015", "016", "017", "018", "019", "020",
        "021", "022", "023", "024", "025", "026", "027", "028", "029", "030",
        "031", "032", "033", "034", "035", "036", "037", "038", "039", "040",
        "041", "042", "043", "044", "045", "046", "047", "048", "049", "050",
        "051", "052", "053", "054", "055", "056", "057", "058", "059", "060",
        "061", "062", "063", "064", "065", "066", "067", "068", "069", "070",
        "071", "072", "073", "074", "075", "076", "077", "078", "079", "080",
        "081", "082", "083", "084", "085", "086", "087", "088", "089", "090",
        "091", "092", "093", "094", "095", "096", "097", "098", "099", "100",
        "101", "102", "103", "104", "105", "106", "107", "108", "109", "110",
        "111", "112", "113", "114", "115", "116", "117", "118", "119", "120",
        "121", "122", "123", "124", "125", "126", "127", "128", "129", "130",
        "131", "132", "133", "134", "135", "136", "137", "138", "139", "140",
        "141", "142", "143", "144", "145", "146", "147", "148", "149", "150",
        "151", "152", "153", "154", "155", "156", "157", "158", "159", "160"
    ];

    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    
    return `${prefix}.${suffix}`;
}


function createNameTag(mesh) {
    const name = generateRandomName();
    
    // Create a canvas element
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    // Set font and measure text
    const fontSize = 10; // Smaller font size
    context.font = `Bold ${fontSize}px Arial`;
    context.fillStyle = 'rgba(255,255,255,1)';
    const textWidth = context.measureText(name).width;
    const textHeight = fontSize; // Adjust height based on font size

    // Set canvas size based on text dimensions
    canvas.width = textWidth + 10; // Add some padding
    canvas.height = textHeight + 10; // Add some padding
    
    // Draw the text on the canvas
    context.font = `Bold ${fontSize}px Arial`;
    context.fillStyle = 'rgba(255,255,255,1)';
    context.textAlign = 'left'; // Align text to the left
    context.textBaseline = 'top'; // Align text to the top
    context.fillText(name, 5, 5); // Position text slightly within the canvas

    // Create a texture from the canvas
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(spriteMaterial);
    
    // Set the scale of the sprite based on the canvas size
    sprite.scale.set(canvas.width / 10, canvas.height / 10, 1); // Adjust the scale factor as needed
    
    // Adjust the sprite position to move it to the left
    const spriteOffsetX = -canvas.width / 20; // Move the sprite left by this amount
    sprite.position.set(spriteOffsetX, 10, 0);  // Adjust the x position to move the sprite left

    // Add sprite to the scene
    scene.add(sprite);
    
    // Ensure the nametag is visible through walls
    sprite.renderOrder = 999;
    sprite.onBeforeRender = function(renderer) { renderer.clearDepth(); };
    
    return sprite;
}


function updateNameTagPosition(nameTag, mesh) {
    const pos = new THREE.Vector3();
    mesh.getWorldPosition(pos);
    nameTag.position.set(pos.x, pos.y + 2, pos.z);  // Adjust height above the mesh as needed
}

function updateNameTagScale(nameTag, camera) {
    const distanceToCamera = camera.position.distanceTo(nameTag.position);

    // Definir un tamaño base (ajustable según el tamaño deseado)
    const baseSize = 1.3; // Ajusta este valor para cambiar el tamaño visual

    // Ajustar la escala de manera proporcional a la distancia
    const scaleFactor = distanceToCamera * 0.1; // Ajusta este factor si es necesario

    const zScaleFactor = 0.5;

    const yScaleFactor = distanceToCamera * 0.05;
    // Aplicar la escala calculada de manera uniforme en X y Y
    nameTag.scale.set(baseSize * scaleFactor, baseSize * yScaleFactor, zScaleFactor * scaleFactor);  // Mantener un tamaño relativo constante
}

loader.load('piezas/finalrostro.fbx', (object) => {
    object.position.set(-15, -20, -20);
    object.scale.set(0.55, 0.55, 0.55);

    object.updateMatrixWorld(true);

    // Crear un array para almacenar los meshes
    const meshes = [];

    // Usar traverse para recoger todos los meshes en un array
    object.traverse(function (child) {
        if (child instanceof THREE.Mesh) {
            meshes.push(child); // Agregar el mesh al array
        }
    });

    // Usar forEach en el array de meshes
    meshes.forEach(function (child) {
        // Cambiar el material del mesh
        child.material = new THREE.MeshBasicMaterial({ 
            color: child.material.color,
            map: child.material.map // Mantiene la textura original, si la hay
        });

        // Actualizar la matriz del mesh
        child.updateMatrixWorld(true);
        
        const nameTag = createNameTag(child);
        const globalPosition = new THREE.Vector3();
        const globalQuaternion = new THREE.Quaternion();
        const globalScale = new THREE.Vector3();

        // Obtener posición, rotación y escala global
        child.getWorldPosition(globalPosition);
        child.getWorldQuaternion(globalQuaternion);
        child.getWorldScale(globalScale);

        // Calcular la Bounding Sphere 
        const boundingSphere = new THREE.Sphere();
        child.geometry.computeBoundingSphere();
        boundingSphere.copy(child.geometry.boundingSphere);

        // Escalar el radio de la Bounding Sphere según la escala global
        const radius = boundingSphere.radius * globalScale.length() / Math.sqrt(3) * 0.80;

        // Crear la esfera en CANNON
        const sphereShape = new CANNON.Sphere(radius);
        const body = new CANNON.Body({ 
            mass: 1, 
            angularDamping: 0.5,
            linearDamping: 0.5,
            collisionFilterGroup: 0,
            collisionFilterMask: 0,
            material: new CANNON.Material({
                friction: 1,  // Fricción moderada
                restitution: 0.1  // Baja restitución para evitar rebotes exagerados
            })
        });

        // Añadir la esfera al cuerpo físico
        body.addShape(sphereShape);

        // Configurar la posición y rotación del cuerpo
        body.position.copy(globalPosition);
        body.quaternion.copy(globalQuaternion);
        body.fixedRotation = true;  
        body.angularDamping = 1.0;
        body.collisionFilterGroup = 0;
        body.collisionFilterMask = 0;
        body.mass = 0;

        // Agregar el cuerpo al mundo físico
        world.addBody(body);

        // Actualizar la posición, rotación y escala del mesh
        child.position.copy(globalPosition);
        child.quaternion.copy(globalQuaternion);
        child.scale.copy(globalScale);
        child.material.metalness = 1.0;
        child.material.roughness = 0;
        child.material.needsUpdate = true;

        // Añadir el mesh a la escena
        scene.add(child);

        // Añadir el objeto físico al sistema
        addPhysicsObject(child, body);
        nameTags.push({ sprite: nameTag, mesh: child });
    });
}, undefined, function (error) {
    console.error('An error happened:', error);
});



// Controles de primera persona
const controls = new PointerLockControls(camera, document.body);
scene.add(controls.getObject());

const instructions = document.createElement('div');
instructions.style.position = 'absolute';
instructions.style.top = '50%';
instructions.style.width = '100%';
instructions.style.textAlign = 'center';
instructions.style.fontSize = '24px';
instructions.style.color = 'white';
instructions.style.fontFamily = 'Arial';
instructions.style.cursor = 'pointer';
instructions.innerHTML = ' click here to play ';
document.body.appendChild(instructions);

const gameInstructions = document.createElement('div');
gameInstructions.style.position = 'absolute';
gameInstructions.style.bottom = '20px'; // Position 20px from the bottom
gameInstructions.style.right = '20px'; // Position 20px from the right
gameInstructions.style.textAlign = 'right'; // Align text to the right
gameInstructions.style.fontSize = '13px'; // Reduce font size for better fit
gameInstructions.style.color = 'white';
gameInstructions.style.fontFamily = 'Arial';
gameInstructions.style.cursor = 'pointer';
gameInstructions.style.display = 'none'; // Initially hidden
gameInstructions.style.lineHeight = '0.5';

// Add game controls instructions
gameInstructions.innerHTML = `
    <p><strong>WASD</strong> to move</p>
    <p>Press <strong>'r'</strong> to rotate objects</p>
    <p>Press <strong>'r' again </strong> to stop rotating</p>
    <p>CLick <strong>on faces and text </strong> to interact</p>
`;
document.body.appendChild(gameInstructions);

instructions.addEventListener('click', function () {
    controls.lock();
});

controls.addEventListener('lock', function () {
    gameInstructions.style.display = '';
    instructions.style.display = 'none';
});

controls.addEventListener('unlock', function () {
    gameInstructions.style.display = 'none';
    if (!isRotating)
        instructions.style.display = '';
});

// Movimiento básico
const moveSpeed = 60.0;
const clock = new THREE.Clock();
const keysPressed = {
    forward: false,
    backward: false,
    left: false,
    right: false
};

document.addEventListener('keydown', (event) => {
    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
            keysPressed.forward = true;
            break;
        case 'ArrowRight':
        case 'KeyD':
            keysPressed.left = true;
            break;
        case 'ArrowDown':
        case 'KeyS':
            keysPressed.backward = true;
            break;
        case 'ArrowLeft':
        case 'KeyA':
            keysPressed.right = true;
            break;
    }
});

document.addEventListener('keyup', (event) => {
    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
            keysPressed.forward = false;
            break;
        case 'ArrowRight':
        case 'KeyD':
            keysPressed.left = false;
            break;
        case 'ArrowDown':
        case 'KeyS':
            keysPressed.backward = false;
            break;
        case 'ArrowLeft':
        case 'KeyA':
            keysPressed.right = false;
            break;
    }
});

const noCollisionGroup = 0x00000000;  // Un grupo sin colisión
const mouse = new THREE.Vector2();

function updateNameTagTexture(sprite, newName) {
   // Limit the new name to 16 characters
   newName = newName.substring(0, 10);

   const canvas = document.createElement('canvas');
   const context = canvas.getContext('2d');
   
   // Define font size and set font
   const fontSize = 10;
   context.font = `Bold ${fontSize}px Arial`;
   
   // Measure text size
   context.fillStyle = 'rgba(255,255,255,1)';
   const textWidth = context.measureText(newName).width;
   const textHeight = fontSize;

   // Set canvas size based on text dimensions
   canvas.width = Math.max(textWidth + 10, 30);  // Ensure a minimum width for short names
   canvas.height = textHeight + 10;

   // Draw the text on the canvas
   context.font = `Bold ${fontSize}px Arial`;
   context.fillStyle = 'rgba(255,255,255,1)';
   context.textAlign = 'left';
   context.textBaseline = 'top';
   context.fillText(newName, 5, 5);

   // Create a new texture from the canvas
   const texture = new THREE.CanvasTexture(canvas);

   // Update the sprite's material with the new texture
   sprite.material.map = texture;
   sprite.material.needsUpdate = true;

   // Adjust the scale dynamically based on text length
   sprite.scale.set(canvas.width / 10, canvas.height / 10, 1); // Adjust the scale factor as needed
}

let isRotating = false;


function onDocumentMouseMove(event) {
    if (controls.isLocked) {
        pointer.x = 0;
        pointer.y = 0;
        raycaster.setFromCamera(pointer, camera);
        return
    }
    if (isRotating && grabbedObject) {
        const deltaMove = {
            x: event.movementX || event.mozMovementX || event.webkitMovementX || 0,
            y: event.movementY || event.mozMovementY || event.webkitMovementY || 0
        };

        // Ajustar sensibilidad de la rotación
        const rotationSpeed = 0.005;  // Ajusta este valor para cambiar la velocidad de rotación

        // Rotar el objeto agarrado basándote en el movimiento del mouse
        grabbedObject.mesh.rotation.y += deltaMove.x * rotationSpeed; // Rotar en el eje Y (horizontalmente)
        grabbedObject.mesh.rotation.x += deltaMove.y * rotationSpeed; // Rotar en el eje X (verticalmente)
        grabbedObject.body.quaternion.copy(grabbedObject.mesh.quaternion); // Sincronizar la rotación del cuerpo con la malla
        if (outlineMesh) {
            outlineMesh.rotation.copy(grabbedObject.mesh.rotation); // Asegúrate de que el outlineMesh rote junto con el objeto
        }
    }
}

function toggleRotationMode() {
    // Alternar el modo de rotación al pulsar "R"
    if (isRotating) {
        // Si ya está en modo de rotación, restaurar el control de la cámara
        controls.lock();

        isRotating = false;
        pointer.x = 0;
        pointer.y = 0;
        raycaster.setFromCamera(pointer, camera);

        console.log('Control de cámara restaurado.');
    } else if (grabbedObject) {
        // Si no está en modo de rotación, desactivar el control de la cámara
        controls.unlock();  // Desbloquea el control de la cámara para que no se mueva
        isRotating = true;
        
        console.log('Modo de rotación activado.');
    }
}

function onDocumentKeyDown(event) {
    if (event.key === 'r' || event.key === 'R') {
        toggleRotationMode();  // Alternar entre el control de rotación y la cámara
    }
}

function onDocumentMouseClick(event) {
    pointer.x = 0;
    pointer.y = 0;
    if (controls.isLocked === false) return;
    console.log('Mouse clicked');
    // Las coordenadas del mouse en espacio de pantalla (-1 a 1)
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);

    const nameTagSprites = nameTags.map(nt => nt.sprite);
    const nameTagIntersects = raycaster.intersectObjects(nameTagSprites);

    if (!isDragging && nameTagIntersects.length > 0) {
        const intersectedSprite = nameTagIntersects[0].object;
        const distance = camera.position.distanceTo(intersectedSprite.position);

        const nameTagObject = nameTags.find(nt => nt.sprite === intersectedSprite);
        if (distance < maxGrabDistance) {
        const newName = prompt('Rename it (max 10 characters):', nameTagObject.mesh.userData.name);

        if (newName) {
            nameTagObject.mesh.userData.name = newName;
            updateNameTagTexture(nameTagObject.sprite, newName);
        }
        return;
        }
    }
    console.log("fumadita1");
    const intersectableMeshes = physicsObjects.map(obj => obj.mesh);
    const objectIntersects = raycaster.intersectObjects(intersectableMeshes, true);

    if (objectIntersects.length > 0) {
        console.log("fumadita");
        if (!grabbedObject) {
            const intersected = objectIntersects[0].object;
            const physicsObject = physicsObjects.find(obj => obj.mesh === intersected);
            isDragging = true;
            if (physicsObject) {
                grabbedObject = physicsObject;

                grabbedObject.body.collisionFilterGroup = noCollisionGroup;
                grabbedObject.body.collisionFilterMask = noCollisionGroup;

                grabOffset.copy(grabbedObject.mesh.position).sub(camera.position);

                if (grabOffset.length() > maxGrabDistance) {
                    console.log("El objeto está demasiado lejos para ser agarrado");
                    grabbedObject = null;
                } else {
                    console.log("Objeto agarrado:", grabbedObject);
                }
            }
        } else {
            grabbedObject.body.collisionFilterGroup = 0;
            grabbedObject.body.collisionFilterMask = 0;
            grabbedObject.body.mass = 0;
            grabbedObject = null;
            isDragging = false;

            console.log("Objeto soltado");
        }
    }
}


// Event listeners para rotación y teclas
document.addEventListener('mousemove', onDocumentMouseMove, false);
document.addEventListener('keydown', onDocumentKeyDown, false);

document.addEventListener('click', onDocumentMouseClick);


function isAlreadyAttached(obj1, obj2) {
    // Revisar si ya existe un constraint entre obj1 y obj2
    return existingConstraints.some(constraint => {
        return (
            (constraint.bodyA === obj1.body && constraint.bodyB === obj2.body) ||
            (constraint.bodyA === obj2.body && constraint.bodyB === obj1.body)
        );
    });
}
const existingConstraints = [];

function checkForCollisions() {
    for (let i = 0; i < physicsObjects.length; i++) {
        const obj1 = physicsObjects[i];
        
        for (let j = i + 1; j < physicsObjects.length; j++) {
            const obj2 = physicsObjects[j];
            
            // Verificar si ya existe un constraint entre obj1 y obj2
            if (isAlreadyAttached(obj1, obj2)) {
                continue; // Saltar si ya están unidos por un constraint
            }
            
            const distance = obj1.body.position.distanceTo(obj2.body.position);
            const combinedRadius = obj1.body.shapes[0].boundingSphereRadius + obj2.body.shapes[0].boundingSphereRadius;
            const collisionThreshold = combinedRadius * 0.7;
            
            // Si los objetos están suficientemente cerca, unirlos
            if (distance < collisionThreshold) {
                attachObject(obj1, obj2);
            }
        }
    }
}





let highlightedObject = null;
let originalMaterial = null;

function attachObject(object1, object2) {
    const maxForce = 1e7;
    const lockConstraint = new CANNON.LockConstraint(object1.body, object2.body, { maxForce });
    world.addConstraint(lockConstraint);

    // object2.body.collisionResponse = false;
        // Guardar el constraint para no crear duplicados
    existingConstraints.push(lockConstraint);

}

let highlightedSprite = null;
let originalSpriteColor = new THREE.Color();

function animate() {
    
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);
    const fixedTimeStep = 1.0 / 60.0;  // 60 FPS
    const maxSubSteps = 3;
    if (controls.isLocked === true) {
        world.step(fixedTimeStep, delta, maxSubSteps);

        raycaster.setFromCamera(pointer, camera);
        
        const direction = new THREE.Vector3();
        const velocity = new THREE.Vector3();

        if (!grabbedObject){
            checkForCollisions();
            if (ghostBody) {
                world.removeConstraint(grabConstraint);
                world.removeBody(ghostBody);
                grabConstraint = null;
                ghostBody = null;
            }
        }
        // Actualizar el raycaster con la dirección de la cámara
        raycaster.setFromCamera(pointer, camera);
        const intersectableMeshes = physicsObjects.map(obj => obj.mesh);
        const nameTagSprites = nameTags.map(nt => nt.sprite);

        // Detectar intersección con objetos interactuables (excluyendo el mapa)
        const intersects = raycaster.intersectObjects(intersectableMeshes, true);
        const nameTagIntersects = raycaster.intersectObjects(nameTagSprites);

        if (highlightedSprite && (!nameTagIntersects.length || highlightedSprite !== nameTagIntersects[0].object)) {
            highlightedSprite.material.color.set(originalSpriteColor); // Restaurar el color original
            highlightedSprite = null;
        }
        // Deshacer el highlight del objeto anterior si ya no está en el centro
        if (highlightedObject && (!intersects.length || highlightedObject !== intersects[0].object)) {
            scene.remove(outlineMesh); // Elimina el borde si existía
            outlineMesh = null;
            highlightedObject.material = originalMaterial; // Restaura el material original
            highlightedObject = null;
        }

        if (nameTagIntersects.length > 0) {
            const intersectedSprite = nameTagIntersects[0].object;

            if (!highlightedSprite || highlightedSprite !== intersectedSprite) {
                if (highlightedSprite) {
                    highlightedSprite.material.color.set(originalSpriteColor); // Restaurar el color original
                }

                highlightedSprite = intersectedSprite;
                originalSpriteColor.copy(intersectedSprite.material.color); // Guardar el color original
                intersectedSprite.material.color.set(0xffff00); // Cambiar el color a amarillo
            }
        } else if (highlightedSprite) {
            highlightedSprite.material.color.set(originalSpriteColor); // Restaurar el color si no hay intersección
            highlightedSprite = null;
        }

        if (intersects.length > 0) {
            const intersected = intersects[0].object;
        
            if (!highlightedObject || highlightedObject !== intersected) {
                if (highlightedObject) {
                    scene.remove(outlineMesh); // Elimina el borde si existía
                    outlineMesh = null;
                    highlightedObject.material = originalMaterial; // Restaura el material original
                }
        
                highlightedObject = intersected;
                originalMaterial = intersected.material; // Guarda el material original
        
                // Crear el borde
                const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide });
                outlineMesh = new THREE.Mesh(intersected.geometry, outlineMaterial);
                outlineMesh.scale.copy(intersected.scale).multiplyScalar(1.05); // Ajusta el tamaño del borde según el objeto original
        
                scene.add(outlineMesh);
            }
            if (outlineMesh) {
                outlineMesh.position.copy(intersected.position);
                outlineMesh.rotation.copy(intersected.rotation);
                outlineMesh.quaternion.copy(intersected.quaternion);
            }
        }
        
        if (grabbedObject) {
            
            grabbedObject.body.wakeUp();
            grabbedObject.body.mass = 1;

            // Crear un cuerpo invisible si no existe
            if (!ghostBody) {
                ghostBody = new CANNON.Body({
                    mass: 0, // Sin masa
                    position: new CANNON.Vec3().copy(grabbedObject.body.position),
                    collisionFilterGroup: 0, // Sin colisiones
                    collisionFilterMask: 0
                });
                world.addBody(ghostBody);

                // Crear un constraint entre el objeto agarrado y el ghostBody
                grabConstraint = new CANNON.LockConstraint(grabbedObject.body, ghostBody);
                world.addConstraint(grabConstraint);
            }

            // Obtener la dirección en la que mira la cámara
            const cameraDirection = new THREE.Vector3();
            camera.getWorldDirection(cameraDirection);

            // Calcular la nueva posición del ghostBody frente al jugador
            const newPos = new THREE.Vector3().copy(camera.position).add(cameraDirection.multiplyScalar(30));
            ghostBody.position.copy(newPos); // El cuerpo invisible sigue esta posición

            grabbedObject.body.collisionFilterGroup = grabbedObject.body.collisionFilterGroup || 1;
            grabbedObject.body.collisionFilterMask = grabbedObject.body.collisionFilterMask || 1;
        
            // Actualizar la posición y orientación de las mallas
            physicsObjects.forEach(({ mesh, body }) => {
                mesh.position.copy(body.position);
                mesh.quaternion.copy(body.quaternion);
            });

            // Actualizar el borde si existe un objeto resaltado
            if (outlineMesh) {
                const intersected = intersects[0]?.object;
                if (intersected) {
                    outlineMesh.position.copy(intersected.position);
                    outlineMesh.rotation.copy(intersected.rotation);
                    outlineMesh.quaternion.copy(intersected.quaternion);
                }
            }

        }

        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();

        const right = new THREE.Vector3();
        right.crossVectors(camera.up, forward).normalize();

        direction.z = Number(keysPressed.forward) - Number(keysPressed.backward);
        direction.x = Number(keysPressed.right) - Number(keysPressed.left);

        velocity.add(forward.clone().multiplyScalar(direction.z));
        velocity.add(right.clone().multiplyScalar(direction.x));
        velocity.normalize().multiplyScalar(moveSpeed);

        const contactNormal = new CANNON.Vec3();
        let numContacts = 0;

        world.contacts.forEach((contact) => {
            if (contact.bi === playerBody || contact.bj === playerBody) {
                if (contact.bi === playerBody) {
                    contact.ni.negate(contactNormal);
                } else {
                    contactNormal.copy(contact.ni);
                }
                numContacts++;
            }
        });

        if (numContacts > 0) {
            const angle = Math.acos(contactNormal.dot(new CANNON.Vec3(0, 1, 0)));
            const maxSlopeAngle = Math.PI / 4;
            if (angle < maxSlopeAngle) {
                playerBody.velocity.x = velocity.x;
                playerBody.velocity.z = velocity.z;
            } else {
                playerBody.velocity.x = 0;
                playerBody.velocity.z = 0;
            }
        }

;

        playerMesh.position.copy(playerBody.position);
        controls.getObject().position.copy(playerBody.position);
        camera.position.y = playerBody.position.y + playerHeight;

        // Sincronizar todas las mallas con sus cuerpos de Cannon.js
        physicsObjects.forEach(({ mesh, body }) => {
            mesh.position.copy(body.position);
            mesh.quaternion.copy(body.quaternion);
        });
        
        nameTags.forEach(({ sprite, mesh }) => {
            updateNameTagPosition(sprite, mesh);
            updateNameTagScale(sprite, camera);
        });

    }

    renderer.render(scene, camera);
}

animate();

// Configura un temporizador para recargar la página cada 15 minutos
setTimeout(function() {
    location.reload(); // Recarga la página para reiniciar el juego
}, 15 * 60 * 1000);